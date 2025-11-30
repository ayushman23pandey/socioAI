const API = "http://localhost:5000";
const container = document.getElementById("reels-container");
const reelsList = document.getElementById("reels-list");
const loading = document.getElementById("loading");

const PAGE_SIZE = 5;
let currentPage = 0;
let isLoading = false;
let hasMore = true;
let currentPlayingVideo = null;
let initialLoadDone = false;

// Check auth
const token = localStorage.getItem("token");
if (!token) {
  alert("Please login first");
  window.location.href = "login.html";
}

// Load initial reels
loadReels();

// Infinite scroll with debouncing
let scrollTimeout;
container.addEventListener("scroll", () => {
  // Don't check scroll until initial load is complete
  if (!initialLoadDone) return;
  
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    
    // Only load more when scrolled near the bottom (within last 200px)
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    if (distanceFromBottom < 200 && !isLoading && hasMore) {
      loadReels();
    }
  }, 200);
});

// Intersection Observer for autoplay
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      
      if (entry.isIntersecting) {
        // Video is in viewport
        if (entry.intersectionRatio >= 0.7) {
          playVideo(video);
        }
      } else {
        // Video is out of viewport
        pauseVideo(video);
      }
    });
  },
  {
    threshold: [0, 0.7, 1],
    root: container
  }
);

async function loadReels() {
  if (isLoading || !hasMore) {
    console.log("Skipping load - isLoading:", isLoading, "hasMore:", hasMore);
    return;
  }

  console.log("Loading reels page:", currentPage);
  isLoading = true;
  loading.style.display = "flex";
  loading.textContent = "Loading...";

  try {
    const res = await fetch(`${API}/reels?page=${currentPage}&limit=${PAGE_SIZE}`);
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const data = await res.json();
    console.log("Received reels:", data);
    const reels = Array.isArray(data.reels) ? data.reels : [];

    if (reels.length > 0) {
      reels.forEach((reel) => createReelElement(reel));
      currentPage++;
      hasMore = typeof data.hasMore === "boolean" ? data.hasMore : reels.length === PAGE_SIZE;
    } else {
      hasMore = false;
      loading.textContent = "No more reels";
    }
    
    // Mark initial load as done after first successful load
    if (!initialLoadDone) {
      initialLoadDone = true;
      console.log("Initial load complete");
    }
    
  } catch (err) {
    console.error("Failed to load reels:", err);
    loading.textContent = "Failed to load reels";
    hasMore = false;
  } finally {
    isLoading = false;
    
    if (!hasMore) {
      const hasRenderedReels = reelsList.children.length > 0;
      loading.textContent = hasRenderedReels ? "No more reels" : "No reels yet";
      loading.style.display = "flex";
    } else {
      loading.style.display = "none";
    }
  }
}

function createReelElement(reel) {
  const reelDiv = document.createElement("div");
  reelDiv.className = "reel";
  reelDiv.dataset.reelId = reel.id;

  const video = document.createElement("video");
  video.src = `${API}${reel.videoPath}`;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.muted = true; // Start muted to allow autoplay

  // Play/pause on tap
  video.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (video.paused) {
      playVideo(video);
    } else {
      pauseVideo(video);
    }
    showPlayPauseIndicator(reelDiv, video.paused);
  });

  // Track view when video starts
  let viewCounted = false;
  video.addEventListener("play", () => {
    if (!viewCounted) {
      recordView(reel.id);
      viewCounted = true;
    }
  });

  const overlay = document.createElement("div");
  overlay.className = "reel-overlay";

  overlay.innerHTML = `
    <div class="play-pause-indicator">⏸️</div>
    <div class="reel-info">
      <div class="reel-content">
        <div class="reel-user">${escapeHtml(reel.userEmail || "User")}</div>
        <div class="reel-caption">${escapeHtml(reel.caption || "")}</div>
      </div>
      <div class="reel-actions">
        <button class="action-btn like-btn" data-reel-id="${reel.id}">
          ❤️
          <span>${reel.likes || 0}</span>
        </button>
        <button class="action-btn">
          💬
          <span>0</span>
        </button>
        <button class="action-btn">
          👁️
          <span>${reel.views || 0}</span>
        </button>
      </div>
    </div>
  `;

  reelDiv.appendChild(video);
  reelDiv.appendChild(overlay);
  reelsList.appendChild(reelDiv);

  // Add like button event listener
  const likeBtn = overlay.querySelector('.like-btn');
  likeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    likeReel(reel.id, likeBtn);
  });

  // Observe video for autoplay
  observer.observe(video);
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function recordView(reelId) {
  try {
    await fetch(`${API}/reels/${reelId}/view`, {
      method: "POST"
    });
  } catch (err) {
    console.error("Failed to record view:", err);
  }
}

function playVideo(video) {
  // Pause currently playing video
  if (currentPlayingVideo && currentPlayingVideo !== video) {
    pauseVideo(currentPlayingVideo);
  }

  // Unmute on first interaction
  video.muted = false;

  const playPromise = video.play();
  
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.log("Autoplay prevented:", err);
      // If autoplay fails, try muted
      video.muted = true;
      video.play().catch(e => console.log("Muted autoplay also failed:", e));
    });
  }
  
  currentPlayingVideo = video;
}

function pauseVideo(video) {
  video.pause();
}

function showPlayPauseIndicator(reelDiv, isPaused) {
  const indicator = reelDiv.querySelector(".play-pause-indicator");
  indicator.textContent = isPaused ? "▶️" : "⏸️";
  
  reelDiv.classList.add("show-indicator");
  setTimeout(() => {
    reelDiv.classList.remove("show-indicator");
  }, 500);
}

async function likeReel(reelId, button) {
  try {
    // Prevent double clicks
    if (button.disabled) return;
    button.disabled = true;

    const res = await fetch(`${API}/reels/${reelId}/like`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();
    
    if (res.ok) {
      button.querySelector("span").textContent = data.likes;
      button.classList.add("liked");
      
      // Animate
      button.style.transform = "scale(1.3)";
      setTimeout(() => {
        button.style.transform = "scale(1)";
        button.disabled = false;
      }, 200);
    } else {
      button.disabled = false;
    }
  } catch (err) {
    console.error("Failed to like reel:", err);
    button.disabled = false;
  }
}

// Remove the global window.likeReel assignment since we use event listeners now
