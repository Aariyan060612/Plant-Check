"use strict";

const cameraVideo = document.getElementById("camera-video");
const photoPreview = document.getElementById("photo-preview");
const photoEmpty = document.getElementById("photo-empty");
const cameraButton = document.getElementById("camera-button");
const snapButton = document.getElementById("snap-button");
const uploadButton = document.getElementById("upload-button");
const photoInput = document.getElementById("photo-input");
const checkButton = document.getElementById("check-button");
const saveButton = document.getElementById("save-button");
const headerStatus = document.getElementById("header-status");
const headerBadge = document.querySelector(".ready-badge");
const photoStatus = document.getElementById("photo-status");
const resultBadge = document.getElementById("result-badge");
const resultEmpty = document.getElementById("result-empty");
const reportContent = document.getElementById("report-content");
const toast = document.getElementById("toast");

let cameraStream = null;
let imageDataUrl = "";
let reportData = null;
let isBusy = false;
let setupChecked = false;
let apiReady = false;
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

function setHeader(message, state = "ready") {
  headerStatus.textContent = message;
  headerBadge.dataset.state = state;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
  }
  cameraStream = null;
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraVideo.hidden = true;
  snapButton.disabled = true;
  if (imageDataUrl) {
    photoPreview.hidden = false;
    photoEmpty.hidden = true;
  } else {
    photoPreview.hidden = true;
    photoEmpty.hidden = false;
  }
  cameraButton.querySelector("span").textContent = "Turn on camera";
  if (!isBusy) updateControls();
}

function updateControls() {
  cameraButton.disabled = isBusy;
  uploadButton.disabled = isBusy || Boolean(cameraStream);
  snapButton.disabled = isBusy || !cameraStream;
  checkButton.disabled = isBusy || !setupChecked || !apiReady || !imageDataUrl || Boolean(cameraStream);
  saveButton.disabled = !reportData || isBusy;
  cameraButton.querySelector("span").textContent = cameraStream ? "Turn off camera" : "Turn on camera";
}

function clearReport() {
  reportData = null;
  reportContent.hidden = true;
  resultEmpty.hidden = false;
  if (!setupChecked) {
    document.getElementById("empty-title").textContent = "Getting ready";
    document.getElementById("empty-copy").textContent = "Please wait a moment";
  } else if (!apiReady) {
    document.getElementById("empty-title").textContent = "App setup needed";
    document.getElementById("empty-copy").textContent = "Ask the person who installed it to add the app key.";
  } else {
    document.getElementById("empty-title").textContent = "Ready when you are";
    document.getElementById("empty-copy").textContent = "Choose a photo to start the plant check";
  }
  resultBadge.textContent = !setupChecked ? "Getting ready" : !apiReady ? "App setup needed" : imageDataUrl ? "Ready to check" : "Not checked yet";
  resultBadge.dataset.state = "uncertain";
}

async function turnOnCamera() {
  if (cameraStream) {
    stopCamera();
    photoStatus.textContent = "Camera off. Take or choose a photo.";
    setHeader(imageDataUrl ? "Photo ready" : "Ready for a photo");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera is not available here. Choose a photo instead.");
    return;
  }

  imageDataUrl = "";
  clearReport();
  photoPreview.hidden = true;
  photoEmpty.hidden = true;
  cameraVideo.hidden = false;
  photoStatus.textContent = "Starting camera";
  setHeader("Starting camera", "busy");
  updateControls();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    photoStatus.textContent = "Camera on. Place one plant in the box.";
    setHeader("Camera is on");
  } catch (error) {
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraVideo.hidden = true;
    photoEmpty.hidden = false;
    photoStatus.textContent = "Camera did not start. Choose a photo instead.";
    setHeader("Camera not ready", "error");
    showToast(error?.name === "NotAllowedError"
      ? "Allow camera access in your browser, or choose a photo."
      : "Camera did not start. Check it, or choose a photo.");
  }
  updateControls();
}

function takePhoto() {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    showToast("Wait until the camera picture appears, then try again.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    showToast("I could not take the photo. Try again.");
    return;
  }
  context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  imageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  photoPreview.src = imageDataUrl;
  photoPreview.hidden = false;
  photoEmpty.hidden = true;
  stopCamera();
  photoStatus.textContent = "Photo ready.";
  setHeader("Photo ready");
  clearReport();
  updateControls();
}

function loadPhoto(file) {
  if (!file) return;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    showToast("Choose a JPG, PNG, or WebP photo.");
    photoInput.value = "";
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showToast("This photo is too large. Choose a smaller one.");
    photoInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showToast("I could not open that photo. Choose another one.");
  reader.onload = () => {
    if (typeof reader.result !== "string") {
      showToast("I could not read that photo. Choose another one.");
      return;
    }
    stopCamera();
    imageDataUrl = reader.result;
    photoPreview.src = imageDataUrl;
    photoPreview.hidden = false;
    photoEmpty.hidden = true;
    photoStatus.textContent = "Photo ready.";
    setHeader("Photo ready");
    clearReport();
    updateControls();
  };
  reader.readAsDataURL(file);
}

function textOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function setList(id, values, emptyId, emptyMessage) {
  const list = document.getElementById(id);
  list.replaceChildren();
  const cleanValues = Array.isArray(values) ? values : [];
  for (const item of cleanValues) {
    const li = document.createElement("li");
    if (typeof item === "string") {
      li.textContent = item;
    } else if (item && typeof item === "object") {
      const name = textOr(item.name, "Possible option");
      const reason = textOr(item.reason, "");
      li.textContent = reason ? `${name}: ${reason}` : name;
    }
    list.append(li);
  }
  const empty = document.getElementById(emptyId);
  empty.hidden = cleanValues.length > 0;
  if (!cleanValues.length && emptyMessage) empty.textContent = emptyMessage;
}

function statusText(status) {
  const map = {
    healthy: "This plant looks well",
    possible_issue: "This plant may have a problem",
    likely_diseased: "This plant may be sick",
    uncertain: "Not sure from this photo",
  };
  return map[status] || map.uncertain;
}

function statusStyle(status) {
  if (status === "healthy") return "healthy";
  if (status === "possible_issue" || status === "likely_diseased") return "issue";
  return "uncertain";
}

function showReport(report) {
  reportData = report;
  const status = report.health_status || "uncertain";
  const style = statusStyle(status);
  document.getElementById("plant-name").textContent = textOr(report.plant_type, "Unknown plant");
  const health = document.getElementById("health-pill");
  health.textContent = statusText(status);
  health.dataset.state = style;
  document.getElementById("confidence").textContent = `${Math.max(0, Math.min(100, Number(report.confidence_percent) || 0))}%`;

  setList("sign-list", report.visible_signs, "no-signs", "No clear signs could be seen in this photo.");
  setList("cause-list", (report.possible_causes || []).map((item) => ({ name: item.name, reason: item.reason })), "no-causes", "No clear cause could be seen.");
  setList("treatment-list", (report.treatment_suggestions_for_local_review || []).map((item) => ({ name: item.name, reason: item.reason })), "no-treatments", "Ask a local crop helper to suggest a safe option.");
  document.getElementById("next-step").textContent = textOr(report.next_step, "Ask a local crop helper to check this plant.");
  const quality = report.image_quality === "poor"
    ? "This photo is unclear. Take a closer photo in daylight."
    : report.image_quality === "good"
      ? "A photo can miss problems. Check the plant in person too."
      : "The photo may not show enough to tell.";
  document.getElementById("quality-note").textContent = quality;

  resultEmpty.hidden = true;
  reportContent.hidden = false;
  resultBadge.textContent = status === "healthy" ? "Looks well" : status === "uncertain" ? "Needs a closer look" : "Check with a crop helper";
  resultBadge.dataset.state = style;
  photoStatus.textContent = "Plant check ready.";
  setHeader("Plant check ready");
  updateControls();
}

async function checkPlant() {
  if (!setupChecked || !apiReady || !imageDataUrl || isBusy) return;
  isBusy = true;
  reportData = null;
  reportContent.hidden = true;
  resultEmpty.hidden = false;
  document.getElementById("empty-title").textContent = "Checking this plant";
  document.getElementById("empty-copy").textContent = "Please wait a moment";
  resultBadge.textContent = "Checking now";
  resultBadge.dataset.state = "uncertain";
  photoStatus.textContent = "Checking the plant. Please wait.";
  setHeader("Checking this plant", "busy");
  updateControls();

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl }),
    });
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) throw new Error(textOr(result.error, "The plant check could not be completed. Try again."));
    showReport(result);
  } catch (error) {
    document.getElementById("empty-title").textContent = "Could not check this photo";
    document.getElementById("empty-copy").textContent = textOr(error.message, "Try again when your connection is steady.");
    resultBadge.textContent = "Try again";
    resultBadge.dataset.state = "uncertain";
    photoStatus.textContent = "The plant check could not be completed.";
    setHeader("Check could not finish", "error");
    showToast(textOr(error.message, "The plant check could not be completed."));
  } finally {
    isBusy = false;
    updateControls();
  }
}

function saveReport() {
  if (!reportData) return;
  const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "plant-report.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  showToast("Report saved.");
}

async function checkAppSetup() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    setupChecked = true;
    apiReady = Boolean(response.ok && status.ready);
  } catch {
    setupChecked = true;
    apiReady = false;
  }
  if (!apiReady) {
    setHeader("App setup needed", "error");
    photoStatus.textContent = "Ask the person who installed it to set up the app.";
    clearReport();
  } else {
    setHeader(imageDataUrl ? "Photo ready" : "Ready for a photo");
    clearReport();
  }
  updateControls();
}

cameraButton.addEventListener("click", turnOnCamera);
snapButton.addEventListener("click", takePhoto);
uploadButton.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => loadPhoto(photoInput.files?.[0]));
checkButton.addEventListener("click", checkPlant);
saveButton.addEventListener("click", saveReport);
window.addEventListener("beforeunload", stopCamera);

clearReport();
updateControls();
checkAppSetup();
