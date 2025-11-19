document.addEventListener("DOMContentLoaded", () => {
  const content = document.getElementById("content");
  const aiChatbot = document.getElementById("aiChatbot");
  const aiInput = document.getElementById("aiInput");
  const aiMessages = document.getElementById("aiMessages");

  document.getElementById("feedBtn").addEventListener("click", () => loadPage("feed.html"));
  document.getElementById("reelsBtn").addEventListener("click", () => loadPage("reels.html"));
  document.getElementById("chatBtn").addEventListener("click", () => loadPage("messages.html"));
  document.getElementById("aiBtn").addEventListener("click", () => aiChatbot.classList.toggle("hidden"));

  aiInput.addEventListener("keypress", e => {
    if (e.key === "Enter") handleAIMessage(aiInput.value);
  });

  // Load an HTML page into #content
  function loadPage(page) {
    fetch(page)
      .then(res => res.text())
      .then(html => {
        content.innerHTML = html;
      })
      .catch(err => {
        content.innerHTML = "<p>Error loading page.</p>";
        console.error(err);
      });
  }

  function handleAIMessage(msg) {
    if (!msg.trim()) return;

    aiMessages.innerHTML += `<p><strong>You:</strong> ${msg}</p>`;
    aiInput.value = "";

    setTimeout(() => {
      let reply = "I'm your SocioAI assistant. How can I help?";

      if (msg.toLowerCase().includes("post")) reply = "To create a post, go to Feed → Create Post.";
      if (msg.toLowerCase().includes("reel")) reply = "Go to Reels to watch or upload reels.";
      if (msg.toLowerCase().includes("message")) reply = "Open Messages to chat with friends.";

      aiMessages.innerHTML += `<p><strong>AI:</strong> ${reply}</p>`;
      aiMessages.scrollTop = aiMessages.scrollHeight;
    }, 800);
  }

  // Load feed by default
  loadPage("feed.html");
});
