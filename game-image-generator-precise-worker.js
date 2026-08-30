/**
 * Precise Game Image Generator - Cloudflare Worker
 * ---------------------------------------------------
 * يستخدم FLUX.2 [dev] من Black Forest Labs - نموذج أحدث وأدق بكثير
 * في اتباع تفاصيل الوصف مقارنة بـ flux-1-schnell، لكنه أبطأ قليلاً.
 */

const MODEL = "@cf/black-forest-labs/flux-2-dev";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function searchGoogleInspiration(query, env) {
  if (!env.GOOGLE_API_KEY || !env.GOOGLE_CSE_ID) {
    return { keywords: [], note: "لم يتم إعداد مفاتيح بحث جوجل، تم التوليد بدون مرحلة البحث." };
  }
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", env.GOOGLE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "5");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString());
  if (!res.ok) return { keywords: [], note: `تعذّر الاتصال ببحث جوجل (${res.status})` };
  const data = await res.json();
  const items = data.items || [];
  const keywords = items.map((it) => it.title || it.snippet).filter(Boolean).slice(0, 5);
  return { keywords, note: null };
}

function buildPrompt(gameName, description, keywords) {
  let prompt = `Original video game environment concept art. Game: "${gameName}". Scene description: ${description}. Follow this description precisely and literally, including every specific object, character, and action mentioned.`;
  if (keywords.length > 0) {
    prompt += ` Visual style inspiration keywords (do not copy any specific existing artwork or characters): ${keywords.join(", ")}.`;
  }
  prompt += " Highly detailed, atmospheric lighting, accurate proportions and physical realism, original digital painting, no text, no watermark, no logos.";
  return prompt;
}

async function generateImageFlux2(prompt, env) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", "1024");
  form.append("height", "768");
  form.append("steps", "30");
  form.append("guidance", "5");

  const formRequest = new Request("http://dummy", { method: "POST", body: form });
  const formStream = formRequest.body;
  const formContentType = formRequest.headers.get("content-type") || "multipart/form-data";

  const resp = await env.AI.run(MODEL, {
    multipart: { body: formStream, contentType: formContentType },
  });
  return resp.image; // base64
}

async function handleGenerate(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.gameName || !body.description) {
    return new Response(
      JSON.stringify({ error: "الرجاء إرسال gameName و description" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  }

  const { gameName, description } = body;
  const searchQuery = `${gameName} game scene ${description}`;

  const { keywords, note } = await searchGoogleInspiration(searchQuery, env);
  const prompt = buildPrompt(gameName, description, keywords);

  const imageBase64 = await generateImageFlux2(prompt, env);

  return new Response(
    JSON.stringify({
      image: `data:image/jpeg;base64,${imageBase64}`,
      promptUsed: prompt,
      inspirationKeywords: keywords,
      note,
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders() } }
  );
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مولّد الصور الدقيق</title>
<style>
  body{font-family:sans-serif; background:#0B1512; color:#EAF3EE; padding:24px; max-width:480px; margin:0 auto;}
  label{display:block; margin-top:16px; font-size:13px; color:#7C948A;}
  input, textarea{width:100%; background:#12201C; border:1px solid #223830; border-radius:8px; padding:10px; color:#EAF3EE; box-sizing:border-box;}
  textarea{min-height:100px;}
  button{margin-top:16px; width:100%; padding:12px; background:#7CFFB2; border:none; border-radius:8px; font-weight:700; cursor:pointer;}
  img{width:100%; border-radius:10px; margin-top:16px;}
  .note{color:#7C948A; font-size:12px; margin-top:8px;}
</style></head><body>
  <h1 style="font-size:20px;">🖼️ مولّد الصور الدقيق (FLUX.2)</h1>
  <p style="color:#7C948A; font-size:13px;">قد يستغرق التوليد وقتًا أطول من المعتاد لدقته الأعلى.</p>
  <label>اسم اللعبة</label>
  <input id="n" placeholder="مثال: مملكة الرمال">
  <label>وصف المشهد</label>
  <textarea id="d" placeholder="اكتب وصفًا دقيقًا للمشهد..."></textarea>
  <button onclick="run()">توليد</button>
  <div id="out"></div>
<script>
async function run(){
  const out = document.getElementById('out');
  out.innerHTML = '<p class="note">جارٍ التوليد (قد يأخذ حتى دقيقة)...</p>';
  try{
    const res = await fetch('/api/generate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ gameName: document.getElementById('n').value, description: document.getElementById('d').value })
    });
    const data = await res.json();
    if(data.error){ out.innerHTML = '<p class="note">'+data.error+'</p>'; return; }
    out.innerHTML = '<img src="'+data.image+'">' + (data.note ? '<p class="note">'+data.note+'</p>' : '');
  }catch(e){ out.innerHTML = '<p class="note">خطأ: '+e.message+'</p>'; }
}
</script>
</body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    if (url.pathname === "/api/generate" && request.method === "POST") {
      try {
        return await handleGenerate(request, env);
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || "حدث خطأ غير متوقع" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
        );
      }
    }

    return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
  },
};
