
async function sendMessage() {
  const input = document.getElementById("prompt");
  const chat = document.getElementById("chat");
  const text = input.value.trim();
  if (!text) return;

  const userDiv = document.createElement("div");
  userDiv.className = "msg user";
  userDiv.textContent = text;
  chat.appendChild(userDiv);

  const aiDiv = document.createElement("div");
  aiDiv.className = "msg ai";
  aiDiv.textContent = "Réflexion en cours...";
  chat.appendChild(aiDiv);

  chat.scrollTop = chat.scrollHeight;
  input.value = "";

    try {
  // 1) Récupérer le modèle dispo côté Ollama (une seule fois)
  if (!window.currentModel) {
    const tagsRes = await fetch("/api/tags");
    const tags = await tagsRes.json();

    if (tags.models && tags.models.length > 0) {
      window.currentModel = tags.models[0].name; // ex: "qwen2.5:0.5b"
    } else {
      window.currentModel = "qwen2.5:0.5b"; // fallback
    }
  }

  const body = {
    model: window.currentModel,
    prompt: text,
    stream: false,
    num_predict: 200
  };

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const raw = await res.text();  // <-- on lit TOUT, sans supposer que c'est du JSON
  let data;

  try {
    data = JSON.parse(raw);
  } catch (err) {
    // Ici, raw commence probablement par "<html>..."
    throw new Error(
      `Réponse non JSON de l'API (status ${res.status}). ` +
      `Souvent = Ollama/Nginx en erreur (502/HTML).`
    );
  }

  aiDiv.textContent = data.response || "(pas de réponse)";
} catch (e) {
  aiDiv.textContent = "Erreur : " + e.message;
}


  chat.scrollTop = chat.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("send-btn").addEventListener("click", sendMessage);
  document.getElementById("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
});

