const API = "http://localhost:5000";
const form = document.getElementById("createReelForm");
const videoInput = document.getElementById("videoFile");
const fileLabel = document.getElementById("fileLabel");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");

// Check auth
const token = localStorage.getItem("token");
if (!token) {
  alert("Please login first");
  window.location.href = "login.html";
}

// Handle file selection
videoInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  
  if (file) {
    // Update label
    fileLabel.classList.add("has-file");
    fileLabel.querySelector(".file-text").textContent = file.name;
    
    // Show video preview
    const videoURL = URL.createObjectURL(file);
    preview.innerHTML = `<video src="${videoURL}" controls></video>`;
    preview.style.display = "block";
    
    // Validate video
    if (!file.type.startsWith("video/")) {
      showStatus("Please select a valid video file", "error");
      videoInput.value = "";
      return;
    }
    
    // Check file size (max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      showStatus("Video file is too large. Maximum size is 100MB", "error");
      videoInput.value = "";
      return;
    }
  }
});

// Handle form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const file = videoInput.files[0];
  
  if (!file) {
    showStatus("Please select a video", "error");
    return;
  }
  
  const formData = new FormData();
  formData.append("video", file);
  formData.append("caption", document.getElementById("caption").value);
  
  // Disable form
  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading...";
  
  try {
    const res = await fetch(`${API}/reels`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    
    const data = await res.json();
    
    if (res.ok) {
      showStatus("✅ Reel uploaded successfully!", "success");
      
      // Redirect after 1.5 seconds
      setTimeout(() => {
        window.location.href = "reels.html";
      }, 1500);
    } else {
      showStatus(`❌ ${data.error || "Upload failed"}`, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload Reel";
    }
  } catch (err) {
    console.error("Upload error:", err);
    showStatus("⚠️ Network error. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Upload Reel";
  }
});

function showStatus(message, type) {
  status.textContent = message;
  status.className = type;
  status.style.display = "block";
  
  if (type === "error") {
    setTimeout(() => {
      status.style.display = "none";
    }, 5000);
  }
}