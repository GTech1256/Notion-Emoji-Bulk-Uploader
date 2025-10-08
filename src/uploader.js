(async () => {
  // =========================
  // ⚙️ НАСТРОЙКИ
  // =========================
  // Если знаешь свои IDs — впиши. Если пусто, попробуем автоопределить.
  let SPACE_ID = "";
  let USER_ID  = "";

  // Берём только devicon "*-original*" и "*-plain*"
  const INCLUDE_WORDMARK = true;           // захватывать *-original-wordmark / *-plain-wordmark
  const EXT_ALLOW = ["svg","png","webp","jpg","jpeg"]; // допустимые расширения

  // Троттлинг/батчинг
  const BATCH_SIZE       = 5;
  const UPLOAD_DELAY_MS  = 300;
  const BATCH_DELAY_MS   = 800;

  // =========================
  // 🧰 HELPERS
  // =========================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const uuid  = () => (crypto.randomUUID?.() ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random()*16|0, v = c==="x"?r:(r&0x3|0x8); return v.toString(16);
    })
  );

  function guessMime(name, fallback = "image/png") {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "svg")  return "image/svg+xml";
    if (ext === "webp") return "image/webp";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png")  return "image/png";
    return fallback;
  }

  function slugifyName(name) {
    return name
      .replace(/\.(png|svg|webp|jpg|jpeg)$/i, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-zA-Z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .toLowerCase()
      .slice(0, 64);
  }

  function xmlTaggingToQuery(xml) {
    if (!xml || typeof xml !== "string") return "";
    const keys = [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map(m => m[1]);
    const vals = [...xml.matchAll(/<Value>(.*?)<\/Value>/g)].map(m => m[1]);
    const pairs = keys.map((k, i) => `${encodeURIComponent(k)}=${encodeURIComponent(vals[i] ?? "")}`);
    return pairs.join("&");
  }

  function pickFiles() {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.accept = "image/*";
      inp.onchange = () => resolve(Array.from(inp.files || []));
      inp.click();
    });
  }

  // =========================
  // 🔎 АВТООПРЕДЕЛЕНИЕ ID (если не заданы)
  // =========================
  async function detectUserAndSpace() {
    // 1) Тянем loadUserContent
    const resp = await fetch("https://www.notion.so/api/v3/loadUserContent", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (!resp.ok) throw new Error("loadUserContent failed");
    const j = await resp.json();
    return pickUserAndSpaceFromRecordMap(j.recordMap);
  }
  
  function pickUserAndSpaceFromRecordMap(recordMap) {
    if (!recordMap) throw new Error("No recordMap in loadUserContent response");
  
    // --- userId
    const users = recordMap.notion_user || {};
    const userId = Object.keys(users)[0];
    if (!userId) throw new Error("Cannot detect user id");
  
    // --- кандидаты воркспейсов
    const spaces = recordMap.space || {};
    const candidates = Object.entries(spaces).map(([id, rec]) => {
      const v = rec?.value || {};
      return {
        id,
        name: v.name || "",
        domain: v.domain || "",
        plan_type: v.plan_type || "",
        subscription_tier: v.subscription_tier || "",
        alive: v.alive !== false
      };
    }).filter(c => c.alive);
  
    if (!candidates.length) throw new Error("No alive spaces found");
  
    // 1) если ровно один — просто вернуть его
    if (candidates.length === 1) {
      return { userId, spaceId: candidates[0].id };
    }
  
    // 2) попытка по домену из URL: https://www.notion.so/<domain>/...
    const maybeDomain = (location.pathname.split("/")[1] || "").toLowerCase();
    if (maybeDomain) {
      const byDomain = candidates.find(c => (c.domain || "").toLowerCase() === maybeDomain);
      if (byDomain) return { userId, spaceId: byDomain.id };
    }
  
    // 3) попытка по space_view_pointers из user_root (обычно первый — «текущий»)
    const userRoot = recordMap.user_root?.[userId]?.value;
    const ptrs = Array.isArray(userRoot?.space_view_pointers) ? userRoot.space_view_pointers : [];
    const ptrSpaceIds = ptrs.map(p => p?.spaceId).filter(Boolean);
    const byPointer = candidates.find(c => ptrSpaceIds.includes(c.id));
    if (byPointer) return { userId, spaceId: byPointer.id };
  
    // 4) попытка по роли «owner» в space_user (если есть несколько воркспейсов)
    const spaceUsers = recordMap.space_user || {};
    const ownerSpace = candidates.find(c => {
      const key = `${userId}|${c.id}`;
      const membership = spaceUsers[key]?.value?.membership_type;
      return membership === "owner";
    });
    if (ownerSpace) return { userId, spaceId: ownerSpace.id };
  
    // 5) финально — показать выбор
    console.table(candidates.map((c, idx) => ({
      idx, id: c.id, name: c.name, domain: c.domain, plan_type: c.plan_type, tier: c.subscription_tier
    })));
    const idxStr = prompt(
      `Найдено несколько воркспейсов. Введи индекс (idx):\n` +
      candidates.map((c, i) => `${i}) ${c.name || "(no name)"} — ${c.domain || "(no domain)"} — ${c.id}`).join("\n")
    );
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
      throw new Error("Invalid selection for space");
    }
    return { userId, spaceId: candidates[idx].id };
  }
  

  // Получить текущее число кастом-эмодзи (alive=true)
  async function getCurrentEmojiCount() {
    const resp = await fetch("https://www.notion.so/api/v3/loadUserContent", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (!resp.ok) throw new Error("loadUserContent failed (for count)");
    const j = await resp.json();
    const map = j?.recordMap?.custom_emoji || {};
    const list = Object.values(map).map(r => r.value).filter(v => v?.alive);
    return list.length || 0;
  }

  // =========================
  // 🌐 NOTION API WRAPPERS
  // =========================
  async function getUploadFileUrl(file) {
    const res = await fetch("https://www.notion.so/api/v3/getUploadFileUrl", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(USER_ID  ? {"x-notion-active-user-header": USER_ID} : {}),
        ...(SPACE_ID ? {"x-notion-space-id": SPACE_ID} : {})
      },
      body: JSON.stringify({
        bucket: "public",
        name: file.name,
        contentType: file.type || guessMime(file.name),
        supportExtraHeaders: true,
        contentLength: file.size
      })
    });
    if (!res.ok) throw new Error("getUploadFileUrl failed");
    return res.json();
  }

  // Загрузка на S3: POST (form) и PUT (signed URL) + x-amz-tagging
  async function uploadToS3(signed, file) {
    if (signed.signedUploadPostUrl && signed.fields) {
      const fd = new FormData();
      Object.entries(signed.fields).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append("file", file, file.name);
      const r = await fetch(signed.signedUploadPostUrl, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`S3 POST failed: ${r.status}`);
      const key = signed.fields?.key;
      const url = signed.signedGetUrl ||
                  (key ? `https://s3-us-west-2.amazonaws.com/public.notion-static.com/${key}` : null);
      return { url };
    }

    const putUrl = signed.signedPutUrl || signed.url || signed.signedGetUrl;
    if (putUrl) {
      const headers = {};
      const contentType =
        (signed.fields && signed.fields["Content-Type"]) ||
        file.type || guessMime(file.name);
      if (contentType) headers["Content-Type"] = contentType;

      if (Array.isArray(signed.postHeaders)) {
        for (const h of signed.postHeaders) if (h?.key) headers[h.key] = h.value ?? "";
      }
      if (Array.isArray(signed.headers)) {
        for (const h of signed.headers) if (h?.key) headers[h.key] = h.value ?? "";
      }

      // Требуется ли x-amz-tagging?
      const needsTaggingHeader = /X-Amz-SignedHeaders=[^&]*x-amz-tagging/i.test(putUrl);
      if (needsTaggingHeader && !("x-amz-tagging" in headers)) {
        let taggingQuery = "";
        if (signed.fields?.tagging) taggingQuery = xmlTaggingToQuery(String(signed.fields.tagging));
        if (!taggingQuery) {
          taggingQuery = `source=UserUpload&env=production&creator=${encodeURIComponent(`notion_user:${USER_ID || "unknown"}::`)}`;
        }
        headers["x-amz-tagging"] = taggingQuery;
      }

      const r = await fetch(putUrl, { method: "PUT", body: file, headers });
      if (!r.ok) {
        if (r.status === 403 && needsTaggingHeader) throw new Error("S3 PUT failed: 403 — нужен header x-amz-tagging.");
        throw new Error(`S3 PUT failed: ${r.status}`);
      }

      const key = signed.key || signed.fields?.key;
      const publicUrl =
        signed.signedGetUrl ||
        (key ? `https://s3-us-west-2.amazonaws.com/public.notion-static.com/${key}` : putUrl.replace(/\?.*$/, ""));
      return { url: publicUrl };
    }

    throw new Error("Unknown getUploadFileUrl response (no fields/put url)");
  }

  function makeCustomEmojiOp({ spaceId, userId, url, name }) {
    const emojiId = uuid();
    return {
      pointer: { table: "custom_emoji", id: emojiId, spaceId },
      path: [],
      command: "set",
      args: {
        id: emojiId,
        url,
        name,
        file_ids: [],
        space_id: spaceId,
        created_by_id: userId,
        created_by_table: "notion_user",
        created_time: Date.now(),
        alive: true
      }
    };
  }

  async function saveTransactions({ spaceId, userId, operations }) {
    const payload = {
      requestId: uuid(),
      transactions: [{
        id: uuid(),
        spaceId,
        debug: { userAction: "customEmojiActions.createCustomEmoji" },
        operations
      }]
    };
    const res = await fetch("https://www.notion.so/api/v3/saveTransactionsFanout", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(USER_ID  ? {"x-notion-active-user-header": userId} : {}),
        ...(SPACE_ID ? {"x-notion-space-id": spaceId} : {})
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("saveTransactionsFanout failed: " + text);
    }
  }

  // =========================
  // 🚀 RUN
  // =========================
  try {
    if (!USER_ID || !SPACE_ID) {
      console.log("🔍 Определяю USER_ID / SPACE_ID...");
      const det = await detectUserAndSpace();
      USER_ID  = USER_ID  || det.userId;
      SPACE_ID = SPACE_ID || det.spaceId;
      console.log("👤 USER:", USER_ID, "| 🏢 SPACE:", SPACE_ID);
    }

    // Сколько слотов доступно?
    const MAX = 500;
    const current = await getCurrentEmojiCount();
    const remaining = Math.max(0, MAX - current);
    if (remaining <= 0) {
      console.warn(`⛔ Лимит достигнут: ${current}/${MAX}. Удали часть эмодзи и повтори.`);
      return;
    }
    console.log(`📦 Свободно слотов: ${remaining} (из ${MAX})`);

    console.log("📁 Выбери файлы-иконки (можно всю папку Devicon)...");
    const allFiles = await pickFiles();
    if (!allFiles.length) return console.warn("Ничего не выбрано — выхожу.");

    // Фильтр Devicon: *-original* и *-plain* (+/- wordmark), только разрешённые расширения
    const wordmarkPart = INCLUDE_WORDMARK ? "(?:-wordmark)?" : ""; // разрешить/запретить -wordmark
    const extRe = EXT_ALLOW.map(e => e.replace(/\./g,"\\.")).join("|");
    const deviconRe = new RegExp(`-(?:original|plain)${wordmarkPart}\\.(?:${extRe})$`, "i");

    let files = allFiles.filter(f => deviconRe.test(f.name));
    if (!files.length) {
      console.warn("После фильтра devicon ничего не осталось. Проверь имена файлов и настройки INCLUDE_WORDMARK/EXT_ALLOW.");
      return;
    }

    // Если больше, чем осталось слотов — укорачиваем
    if (files.length > remaining) {
      console.warn(`⚠️ Выбрано ${files.length}, но доступно только ${remaining} слотов. Возьму первые ${remaining}.`);
      files = files.slice(0, remaining);
    }

    console.log(`🔄 К загрузке: ${files.length} файлов (из выбранных ${allFiles.length}).`);
    const ops = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const prettyName = slugifyName(file.name) || `emoji-${i+1}`;

      console.log(`(${i+1}/${files.length}) ▶️ ${file.name} → upload`);
      const signed = await getUploadFileUrl(file);
      const { url } = await uploadToS3(signed, file);
      if (!url) throw new Error("Не удалось получить публичный URL после загрузки");

      ops.push(makeCustomEmojiOp({ spaceId: SPACE_ID, userId: USER_ID, url, name: prettyName }));
      await sleep(UPLOAD_DELAY_MS);
    }

    console.log(`💾 Отправляю ${ops.length} эмодзи батчами по ${BATCH_SIZE}...`);
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const chunk = ops.slice(i, i + BATCH_SIZE);
      await saveTransactions({ spaceId: SPACE_ID, userId: USER_ID, operations: chunk });
      console.log(`✅ Применено: ${Math.min(i + BATCH_SIZE, ops.length)}/${ops.length}`);
      await sleep(BATCH_DELAY_MS);
    }

    console.log("🎉 Готово! Обнови /emoji — эмодзи должны появиться в Workspace Emoji Library.");
  } catch (e) {
    console.error("❌ Ошибка:", e);
  }
})();
