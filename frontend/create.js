const form = document.getElementById("createForm");
const statusText = document.getElementById("status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  statusText.textContent = "Posting...";

  try {
    const res = await fetch("http://localhost:5000/feeds", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (res.ok) {
      statusText.textContent = "✅ Post created successfully!";
      setTimeout(() => (window.location.href = "feed.html"), 1000);
    } else {
      statusText.textContent = "❌ Error: " + data.error;
    }
  } catch (err) {
    statusText.textContent = "⚠️ Something went wrong.";
  }
});
