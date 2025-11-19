const feedContainer = document.getElementById("feed-container");

async function loadFeed() {
  try {
    const res = await fetch("http://localhost:5000/feeds");
    const feeds = await res.json();

    feedContainer.innerHTML = "";

    if (feeds.length === 0) {
      feedContainer.innerHTML = "<p>No posts yet. Be the first to post!</p>";
      return;
    }

    feeds.reverse().forEach(feed => {
      const postEl = document.createElement("div");
      postEl.className = "post";

      let mediaHTML = "";
      if (feed.filePath) {
        const isVideo = feed.filePath.endsWith(".mp4") || feed.filePath.endsWith(".mov");
        mediaHTML = isVideo
          ? `<video src="http://localhost:5000${feed.filePath}" controls></video>`
          : `<img src="http://localhost:5000${feed.filePath}" alt="Post media">`;
      }

      postEl.innerHTML = `
        <h3>${feed.caption || "Untitled Post"}</h3>
        <p>${feed.text || ""}</p>
        ${mediaHTML}
        <time>${new Date(feed.createdAt).toLocaleString()}</time>
      `;
      feedContainer.appendChild(postEl);
    });
  } catch (err) {
    feedContainer.innerHTML = `<p style="color:red;">Error loading feed: ${err.message}</p>`;
  }
}

loadFeed();
