// Configuration
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyVI3fTuXOEetJWrM-H4NLthE6z-wjaQot6oUgMYv9mXi6L_GRXCu6Zcucc-zA2Mu6nDA/exec";

const ROOT_FOLDER_ID = "1xfnB19Nvk0am-REJr-q9wqLoTAU3S55N";
const POLLING_INTERVAL = 5000; // Check every 5 seconds

// DOM Elements
const foldersContainer = document.getElementById("folders-container");
const foldersList = document.getElementById("folders-list");
const loadingFolders = document.getElementById("loading-folders");
const folderSearch = document.getElementById("folder-search");
const welcomeMessage = document.getElementById("welcome-message");
const contentContainer = document.getElementById("content-container");
const subjectHeader = document.getElementById("subject-header");
const breadcrumbList = document.getElementById("breadcrumb-list");
const contentList = document.getElementById("content-list");
const loadingContent = document.getElementById("loading-content");
const emptyFolderMessage = document.getElementById("empty-folder-message");
const previewModal = document.getElementById("preview-modal");
const previewFilename = document.getElementById("preview-filename");
const previewContainer = document.getElementById("preview-container");
const previewLoading = document.getElementById("preview-loading");
const previewError = document.getElementById("preview-error");
const errorMessage = document.getElementById("error-message");
const pdfContainer = document.getElementById("pdf-container");
const docxContainer = document.getElementById("docx-container");
const docPreviewIframe = document.getElementById("doc-preview-iframe");
const closeModal = document.getElementById("close-modal");
const printButton = document.getElementById("print-button");
const downloadButton = document.getElementById("download-button");

// State
let currentFolderId = null;
let currentSubject = null;
let currentFileId = null;
let currentPreviewUrl = null;
let currentFileBlob = null;
let allFolders = [];
let folderCache = {}; // { folderId: { type: "folders"|"files", content: [] } }
let fileCache = {}; // { fileId: { blob: string, mimeType: string } }
let currentCourse = null;
let cacheTimestamp = new Date().toDateString();
let pollingIntervalId = null;

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  setupEventListeners();
  setupCacheClearInterval();
});

// Initialize the app
async function initApp() {
  previewModal.classList.add("hidden");
  try {
    await loadFolders(ROOT_FOLDER_ID);
  } catch (error) {
    console.error("Error initializing app:", error);
    showErrorMessage(
      foldersList,
      "Failed to load folders. Please refresh the page."
    );
  }
}

// Setup event listeners
function setupEventListeners() {
  closeModal.addEventListener("click", () => {
    previewModal.classList.add("hidden");
    if (currentPreviewUrl) {
      revokeTemporaryAccess(currentFileId).catch((e) =>
        console.error("Failed to revoke temporary access:", e)
      );
      currentPreviewUrl = null;
    }
    docPreviewIframe.src = "";
    currentFileBlob = null;
    printButton.classList.remove("hidden");
  });

  previewModal.addEventListener("click", (e) => {
    if (e.target === previewModal) {
      previewModal.classList.add("hidden");
      if (currentPreviewUrl) {
        revokeTemporaryAccess(currentFileId).catch((e) =>
          console.error("Failed to revoke temporary access:", e)
        );
        currentPreviewUrl = null;
      }
      docPreviewIframe.src = "";
      currentFileBlob = null;
      printButton.classList.remove("hidden");
    }
  });

  printButton.addEventListener("click", printFile);
  downloadButton.addEventListener("click", downloadFile);
  folderSearch.addEventListener("input", (e) =>
    filterFolders(e.target.value.toLowerCase())
  );
}

// Setup daily cache clear interval
function setupCacheClearInterval() {
  setInterval(() => {
    const today = new Date().toDateString();
    if (today !== cacheTimestamp) {
      folderCache = {};
      fileCache = {};
      cacheTimestamp = today;
      console.log("Cache cleared for new day:", today);
    }
  }, 60 * 60 * 1000); // Check every hour
}

// Start polling for updates
function startPolling(folderId, isSubject) {
  if (pollingIntervalId) clearInterval(pollingIntervalId);
  pollingIntervalId = setInterval(async () => {
    try {
      if (isSubject) {
        await updateFiles(folderId);
      } else {
        await updateSubfolders(folderId);
      }
    } catch (error) {
      console.error("Polling error:", error);
    }
  }, POLLING_INTERVAL);
}

// Stop polling
function stopPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

// Filter folders based on search term
function filterFolders(searchTerm) {
  const folderItems = foldersList.querySelectorAll(".folder-item");
  folderItems.forEach((item) => {
    const folderName = item
      .querySelector(".folder-name")
      .textContent.toLowerCase();
    item.classList.toggle("hidden", !folderName.includes(searchTerm));
  });
}

// Load folders from Google Drive
async function loadFolders(folderId) {
  if (folderCache[folderId]) {
    renderFolders(folderCache[folderId].content);
    return;
  }
  foldersList.querySelector("tbody").innerHTML = "";
  loadingFolders.classList.remove("hidden");
  try {
    let folders = await fetchFolders(folderId);
    folders = folders.sort((a, b) => a.name.localeCompare(b.name)); // Sort before rendering
    allFolders = folders;
    folderCache[folderId] = { type: "folders", content: folders };
    console.log(`${folders[0]?.name || folderId} folder cached`);
    if (folders.length === 0) {
      foldersList.querySelector("tbody").innerHTML =
        '<tr><th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">No folders found</th></tr>';
    } else {
      renderFolders(folders);
    }
  } catch (error) {
    console.error("Error loading folders:", error);
    showErrorMessage(
      foldersList.querySelector("tbody"),
      "Failed to load folders"
    );
  } finally {
    loadingFolders.classList.add("hidden");
  }
}

// Render folders in the left pane
function renderFolders(folders) {
  const tbody = foldersList.querySelector("tbody");
  tbody.innerHTML = "";
  folders.forEach((folder) => {
    const folderItem = document.createElement("tr");
    folderItem.className =
      "folder-item bg-white border-b dark:bg-gray-800 dark:border-gray-700 border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer";
    folderItem.dataset.id = folder.id;
    folderItem.dataset.name = folder.name;
    folderItem.innerHTML = `
      <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">
        <div class="flex items-center">
          <div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center mr-3">
            <svg class="w-6 h-6 text-gray-500 dark:text-gray-500" aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                <path fill-rule="evenodd"
                    d="M3 6a2 2 0 0 1 2-2h5.532a2 2 0 0 1 1.536.72l1.9 2.28H3V6Zm0 3v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9H3Z"
                    clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1">
            <div class="folder-name">${folder.name}</div>
            <div class="text-xs text-gray-500">${
              folder.isSubject ? "Subject" : "Course"
            }</div>
          </div>
        </div>
      </th>
    `;

    folderItem.addEventListener("mouseenter", () => {
      const svg = folderItem.querySelector("svg");
      if (svg) {
        svg.classList.remove("text-gray-500", "dark:text-gray-500");
        svg.classList.add("text-blue-700");
      }
    });

    folderItem.addEventListener("mouseleave", () => {
      const svg = folderItem.querySelector("svg");
      if (svg) {
        svg.classList.remove("text-blue-700");
        svg.classList.add("text-gray-500", "dark:text-gray-500");
      }
    });

    folderItem.addEventListener("click", () =>
      selectFolder(folder.id, folder.name, folder.isSubject)
    );

    tbody.appendChild(folderItem);
  });
}

// Select a folder and load its contents
async function selectFolder(folderId, folderName, isSubject) {
  currentFolderId = folderId;
  foldersList.querySelectorAll(".folder-item").forEach((item) => {
    item.classList.toggle("bg-gray-100", item.dataset.id === folderId);
  });
  welcomeMessage.classList.add("hidden");
  contentContainer.classList.remove("hidden");

  if (folderCache[folderId]) {
    emptyFolderMessage.classList.add("hidden");
    contentList.innerHTML = "";
    if (isSubject) {
      currentSubject = folderName;
      subjectHeader.classList.remove("hidden");
      updateBreadcrumb(
        currentCourse ? currentCourse.name : "Courses",
        folderName
      );
      renderFiles(folderCache[folderId].content);
      preloadFiles(folderCache[folderId].content);
    } else {
      currentCourse = { id: folderId, name: folderName };
      currentSubject = null;
      subjectHeader.classList.add("hidden");
      renderSubfolders(folderCache[folderId].content);
    }
    startPolling(folderId, isSubject);
    return;
  }

  loadingContent.classList.remove("hidden");
  emptyFolderMessage.classList.add("hidden");
  contentList.innerHTML = "";

  try {
    if (isSubject) {
      currentSubject = folderName;
      subjectHeader.classList.remove("hidden");
      updateBreadcrumb(
        currentCourse ? currentCourse.name : "Courses",
        folderName
      );
      await loadFiles(folderId);
    } else {
      currentCourse = { id: folderId, name: folderName };
      currentSubject = null;
      subjectHeader.classList.add("hidden");
      await loadSubfolders(folderId);
    }
    startPolling(folderId, isSubject);
  } catch (error) {
    console.error("Error loading content:", error);
    showErrorMessage(contentList, "Failed to load content");
    stopPolling();
  } finally {
    loadingContent.classList.add("hidden");
  }
}

// Update breadcrumb with new search bar and category-based filtering
function updateBreadcrumb(courseName, subjectName = null) {
  breadcrumbList.innerHTML = "";

  const courseLi = document.createElement("li");
  courseLi.className = "inline-flex items-center";
  courseLi.innerHTML = `
    <a href="#" class="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600 dark:text-gray-400 dark:hover:text-white">
      <svg class="w-3 h-3 me-2.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
        <path d="m19.707 9.293-2-2-7-7a1 1 0 0 0-1.414 0l-7 7-2 2a1 1 0 0 0 1.414 1.414L2 10.414V18a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7.586l.293.293a1 1 0 0 0 1.414-1.414Z"/>
      </svg>
      ${courseName}
    </a>
  `;
  courseLi.querySelector("a").addEventListener("click", (e) => {
    e.preventDefault();
    if (currentCourse)
      selectFolder(currentCourse.id, currentCourse.name, false);
  });
  breadcrumbList.appendChild(courseLi);

  if (subjectName) {
    const subjectLi = document.createElement("li");
    subjectLi.innerHTML = `
      <div class="flex items-center">
        <svg class="rtl:rotate-180 w-3 h-3 text-gray-400 mx-1" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 6 10">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 9 4-4-4-4"/>
        </svg>
        <a href="#" class="ms-1 text-sm font-medium text-gray-700 hover:text-blue-600 md:ms-2 dark:text-gray-400 dark:hover:text-white">${subjectName}</a>
      </div>
    `;
    subjectLi.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      if (currentFolderId) selectFolder(currentFolderId, subjectName, true);
    });
    breadcrumbList.appendChild(subjectLi);
  }

  const searchLi = document.createElement("li");
  searchLi.className = "inline-flex items-center ms-4";
  searchLi.innerHTML = `
    <form class="max-w-lg mx-auto">
      <div class="flex">
        <label for="category-select" class="sr-only">Category</label>
        <div class="relative z-0">
          <select id="category-select" class="cursor-pointer bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-s-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" style="border-top-left-radius: 25px; border-bottom-left-radius: 25px;">
            <option disabled value="">Select Category</option>
            <option class="cursor-pointer" value="Roll Number">Roll Number</option>
            <option class="cursor-pointer" value="File ID">File ID</option>
            <option class="cursor-pointer" value="Experiment No.">Experiment No.</option>
            <option class="cursor-pointer" value="Time">Time</option>
            <option class="cursor-pointer" value="Size">Size</option>
            <option class="cursor-pointer" value="File Type">File Type</option>
          </select>
        </div>
        <div class="relative w-full">
          <input type="text" id="search-dropdown" class="block p-2.5 w-full z-20 text-sm text-gray-900 bg-gray-50 rounded-e-lg border-s-gray-50 border-s-2 border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-s-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:border-blue-500" placeholder="Search files..." required style="border-top-right-radius: 25px; border-bottom-right-radius: 25px;"/>
          <button type="submit" class="absolute top-0 end-0 p-2.5 text-sm font-medium h-full text-blue-600">
            <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
            </svg>
            <span class="sr-only">Search</span>
          </button>
        </div>
      </div>
    </form>
  `;
  breadcrumbList.appendChild(searchLi);

  // Handle category selection and search
  let selectedCategory = "Roll Number"; // Default category
  const categorySelect = document.getElementById("category-select");
  const searchInput = document.getElementById("search-dropdown");

  // Set default selected category
  categorySelect.value = selectedCategory;

  // Update selected category on change
  categorySelect.addEventListener("change", (e) => {
    selectedCategory = e.target.value;
    filterFiles(searchInput.value, selectedCategory); // Trigger filtering with current input
  });

  // Search input handling
  searchInput.addEventListener("input", (e) => {
    filterFiles(e.target.value, selectedCategory);
  });

  // Prevent form submission and trigger search
  searchLi.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    filterFiles(searchInput.value, selectedCategory);
  });
}

// New function to filter files based on selected category
function filterFiles(searchTerm, category) {
  const searchValue = searchTerm.toLowerCase();
  const fileItems = contentList.querySelectorAll(".chat-bubble");

  fileItems.forEach((item) => {
    let textToSearch = "";
    switch (category) {
      case "Roll Number":
        textToSearch = item
          .querySelector(".roll-number")
          .textContent.toLowerCase();
        break;
      case "File ID":
        textToSearch = item.querySelector("a").textContent.toLowerCase();
        break;
      case "Experiment No.":
        textToSearch = item
          .querySelector(".experiment-number")
          .textContent.toLowerCase();
        break;
      case "Time":
        textToSearch = item.querySelector("time").textContent.toLowerCase();
        break;
      case "Size":
        textToSearch = item
          .querySelector(".file-size")
          .textContent.toLowerCase();
        break;
      case "File Type":
        textToSearch = item
          .querySelector(".file-type")
          .textContent.toLowerCase();
        break;
    }
    item.style.display = textToSearch.includes(searchValue) ? "" : "none";
  });
}

// Load subfolders for a course folder
async function loadSubfolders(folderId) {
  let subfolders = await fetchFolders(folderId);
  subfolders = subfolders.sort((a, b) => a.name.localeCompare(b.name)); // Sort before caching/rendering
  folderCache[folderId] = { type: "folders", content: subfolders };
  if (subfolders.length === 0) {
    emptyFolderMessage.classList.remove("hidden");
  } else {
    emptyFolderMessage.classList.add("hidden");
    renderSubfolders(subfolders);
  }
}

// Update subfolders automatically
async function updateSubfolders(folderId) {
  if (currentFolderId !== folderId) return;
  let subfolders = await fetchFolders(folderId);
  subfolders = subfolders.sort((a, b) => a.name.localeCompare(b.name)); // Sort before comparison
  const cached = folderCache[folderId];
  if (JSON.stringify(cached.content) !== JSON.stringify(subfolders)) {
    folderCache[folderId] = { type: "folders", content: subfolders };
    console.log(`${currentCourse?.name || folderId} folder cached`);
    if (subfolders.length === 0) {
      emptyFolderMessage.classList.remove("hidden");
      contentList.innerHTML = "";
    } else {
      emptyFolderMessage.classList.add("hidden");
      renderSubfolders(subfolders);
    }
  }
}

// Render subfolders in the right pane
function renderSubfolders(subfolders) {
  contentList.classList.remove("pl-4");

  contentList.innerHTML = `
    <div class="p-5 border border-gray-100 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700">
      <time class="text-lg font-semibold text-gray-900 dark:text-white"></time>
      <form class="max-w-md mx-auto mb-3 sticky top-0 z-10">
        <label for="subject-search" class="mb-2 text-sm font-medium text-gray-900 sr-only dark:text-white">Search</label>
        <div class="relative">
          <div class="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none">
            <svg class="w-4 h-4 text-blue-600 dark:text-blue-600" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z"/>
            </svg>
          </div>
          <input type="text" id="subject-search" class="block w-full p-2 ps-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500" placeholder="Search subjects..." required style="border-radius: 25px;"/>
        </div>
      </form>
      <ol class="mt-3 divide-y divide-y-gray-200 dark:divide-gray-700 overflow-y-auto" style="height: 415px;"></ol>
    </div>
  `;
  const ol = contentList.querySelector("ol");
  subfolders.forEach((folder) => {
    const subfolderItem = document.createElement("li");
    subfolderItem.innerHTML = `
      <a href="#" class="flex items-center p-2 bg-gray-100 hover:bg-blue-600 transform scale-95 transition duration-300 ease-in-out hover:scale-100 group" style="
    border-radius: 40px;
    margin-top: 5px;
    margin-bottom: 5px;
    margin-right: 7px;">
        <div class="w-12 h-12 bg-gray-200 rounded-full flex-shrink-0 mr-3">
          <i class="fas fa-folder text-gray-500 w-11 h-11 flex items-center justify-center" style="margin-top: 2px; margin-bottom: 2px; margin-right: 2px; margin-left: 2px;"></i>
        </div>
        <div class="text-base font-normal text-gray-600 dark:text-gray-400 sm:flex-1">
          <span class="font-medium text-gray-900 dark:text-white group-hover:text-gray-200">${folder.name}</span>
        </div>
        <svg class="w-6 h-6 text-gray-800 dark:text-white ml-auto sm:ml-3 group-hover:text-gray-200" aria-hidden="true"
             xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 12H5m14 0-4 4m4-4-4-4" />
        </svg>
      </a>
    `;
    subfolderItem.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      selectFolder(folder.id, folder.name, true);
    });
    ol.appendChild(subfolderItem);
  });

  document.getElementById("subject-search").addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const subjectItems = contentList.querySelectorAll("li");
    subjectItems.forEach((item) => {
      const subjectName = item.querySelector("span").textContent.toLowerCase();
      item.style.display = subjectName.includes(searchTerm) ? "" : "none";
    });
  });
}

// Load files for a subject folder
async function loadFiles(folderId) {
  let files = await fetchFiles(folderId);
  files = files.sort((a, b) => {
    const rollA = a.rollNumber || "Unknown";
    const rollB = b.rollNumber || "Unknown";
    return rollA.localeCompare(rollB, undefined, { numeric: true });
  }); // Sort before caching/rendering
  folderCache[folderId] = { type: "files", content: files };
  console.log(`${currentSubject || folderId} folder cached`);
  if (files.length === 0) {
    emptyFolderMessage.classList.remove("hidden");
  } else {
    emptyFolderMessage.classList.add("hidden");
    renderFiles(files);
    preloadFiles(files);
  }
}

// Preload files into fileCache
async function preloadFiles(files) {
  for (const file of files) {
    if (!fileCache[file.id]) {
      const fileExtension = file.name.split(".").pop().toLowerCase();
      if (["pdf", "doc", "docx"].includes(fileExtension)) {
        try {
          const content = await fetchFileContent(file.id);
          if (content) {
            const blob = `data:${file.mimeType};base64,${content}`;
            fileCache[file.id] = { blob, mimeType: file.mimeType };
            console.log(`${file.name} cached`);
          }
        } catch (error) {
          console.error(`Error preloading file ${file.id}:`, error);
        }
      }
    }
  }
}

// Update files automatically
async function updateFiles(folderId) {
  if (currentFolderId !== folderId) return;
  let files = await fetchFiles(folderId);
  files = files.sort((a, b) => {
    const rollA = a.rollNumber || "Unknown";
    const rollB = b.rollNumber || "Unknown";
    return rollA.localeCompare(rollB, undefined, { numeric: true });
  }); // Sort before comparison
  const cached = folderCache[folderId];
  if (JSON.stringify(cached.content) !== JSON.stringify(files)) {
    folderCache[folderId] = { type: "files", content: files };
    console.log(`${currentSubject || folderId} folder cached`);
    if (files.length === 0) {
      emptyFolderMessage.classList.remove("hidden");
      contentList.innerHTML = "";
    } else {
      emptyFolderMessage.classList.add("hidden");
      renderFiles(files);
      preloadFiles(files);
    }
  }
}

// Render files in a chat-like format
function renderFiles(files) {
  contentList.classList.add("pl-4");

  contentList.innerHTML = `
    <ol class="p-2 relative border-s border-gray-200 dark:border-gray-700"></ol>
  `;
  const ol = contentList.querySelector("ol");

  function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const day = date.getDate().toString().padStart(2, "0");
    const monthNames = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
  }

  files.forEach((file) => {
    const fileExtension = file.name.split(".").pop().toLowerCase();
    const rollNumber = file.rollNumber || "Unknown";
    const fileId = file.fileId || "Unknown";
    const experimentNumber = file.experimentNumber || "Unknown";
    const time = file.lastUpdated
      ? formatDateTime(file.lastUpdated)
      : "Unknown";
    const pages = file.pages || "Unknown";
    const size = file.size || "Unknown";
    const fileType = file.fileType || "Unknown";

    const pdfIcon = `
      <svg fill="none" aria-hidden="true" class="w-5 h-5 shrink-0" viewBox="0 0 20 21">
        <g clip-path="url(#clip0_3173_1381)">
          <path fill="#E2E5E7" d="M5.024.5c-.688 0-1.25.563-1.25 1.25v17.5c0 .688.562 1.25 1.25 1.25h12.5c.687 0 1.25-.563 1.25-1.25V5.5l-5-5h-8.75z"></path>
          <path fill="#B0B7BD" d="M15.024 5.5h3.75l-5-5v3.75c0 .688.562 1.25 1.25 1.25z"></path>
          <path fill="#CAD1D8" d="M18.774 9.25l-3.75-3.75h3.75v3.75z"></path>
          <path fill="#F15642" d="M16.274 16.75a.627.627 0 01-.625.625H1.899a.627.627 0 01-.625-.625V10.5c0-.344.281-.625.625-.625h13.75c.344 0 .625.281.625.625v6.25z"></path>
          <path fill="#fff" d="M3.998 12.342c0-.165.13-.345.34-.345h1.154c.65 0 1.235.435 1.235 1.269 0 .79-.585 1.23-1.235 1.23h-.834v.66c0 .22-.14.344-.32.344a.337.337 0 01-.34-.344v-2.814zm.66.284v1.245h.834c.335 0 .6-.295.6-.605 0-.35-.265-.64-.6-.64h-.834zM7.706 15.5c-.165 0-.345-.09-.345-.31v-2.838c0-.18.18-.31.345-.31H8.85c2.284 0 2.234 3.458.045 3.458h-1.19zm.315-2.848v2.239h.83c1.349 0 1.409-2.24 0-2.24h-.83zM11.894 13.486h1.274c.18 0 .36.18.36.355 0 .165-.18.3-.36.3h-1.274v1.049c0 .175-.124.31-.3.31-.22 0-.354-.135-.354-.31v-2.839c0-.18.135-.31.355-.31h1.754c.22 0 .35.13.35.31 0 .16-.13.34-.35.34h-1.455v.795z"></path>
          <path fill="#CAD1D8" d="M15.649 17.375H3.774V18h11.875a.627.627 0 00.625-.625v-.625a.627.627 0 01-.625.625z"></path>
        </g>
        <defs>
          <clipPath id="clip0_3173_1381">
            <path fill="#fff" d="M0 0h20v20H0z" transform="translate(0 .5)"></path>
          </clipPath>
        </defs>
      </svg>
    `;
    const docIcon = `
      <svg version="1.1" id="Livello_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 512 512" style="enable-background:new 0 0 512 512" xml:space="preserve" class="w-5 h-5 shrink-0">
        <style type="text/css">.st0{fill:#41A5EE;} .st1{fill:#2B7CD3;} .st2{fill:#185ABD;} .st3{fill:#103F91;} .st4{opacity:0.1;enable-background:new;} .st5{opacity:0.2;enable-background:new;} .st6{fill:url(#SVGID_1_);} .st7{fill:#FFFFFF;}</style>
        <path class="st0" d="M490.17,19.2H140.9c-12.05,0-21.83,9.72-21.83,21.7l0,0v96.7l202.42,59.2L512,137.6V40.9C512,28.91,502.23,19.2,490.17,19.2z"/>
        <path class="st1" d="M512,137.6H119.07V256l202.42,35.52L512,256V137.6z"/>
        <path class="st2" d="M119.07,256v118.4l190.51,23.68L512,374.4V256H119.07z"/>
        <path class="st3" d="M140.9,492.8h349.28c12.05,0,21.83-9.72,21.83-21.7l0,0v-96.7H119.07v96.7C119.07,483.09,128.84,492.8,140.9,492.8z"/>
        <path class="st4" d="M263.94,113.92H119.07v296h144.87c12.04-0.04,21.79-9.73,21.83-21.7v-252.6C285.73,123.65,275.98,113.96,263.94,113.92z"/>
        <path class="st5" d="M252.04,125.76H119.07v296h132.97c12.04-0.04,21.79-9.73,21.83-21.7v-252.6C273.82,135.49,264.07,125.8,252.04,125.76z"/>
        <path class="st5" d="M252.04,125.76H119.07v272.32h132.97c12.04-0.04,21.79-9.73,21.83-21.7V147.46C273.82,135.49,264.07,125.8,252.04,125.76z"/>
        <path class="st5" d="M240.13,125.76H119.07v272.32h121.06c12.04-0.04,21.79-9.73,21.83-21.7V147.46C261.91,135.49,252.17,125.8,240.13,125.76z"/>
        <linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="45.8183" y1="-1083.4916" x2="216.1361" y2="-788.5082" gradientTransform="matrix(1 0 0 1 0 1192)">
          <stop offset="0" style="stop-color:#2368C4"/>
          <stop offset="0.5" style="stop-color:#1A5DBE"/>
          <stop offset="1" style="stop-color:#1146AC"/>
        </linearGradient>
        <path class="st6" d="M21.83,125.76h218.3c12.05,0,21.83,9.72,21.83,21.7v217.08c0,11.99-9.77,21.7-21.83,21.7H21.83C9.77,386.24,0,376.52,0,364.54V147.46C0,135.48,9.77,125.76,21.83,125.76z"/>
        <path class="st7" d="M89.56,292.21c0.43,3.35,0.71,6.26,0.85,8.76h0.5c0.19-2.37,0.59-5.22,1.19-8.56c0.6-3.34,1.15-6.16,1.63-8.47l22.96-98.49h29.68l23.81,97.01c1.38,6.03,2.37,12.15,2.96,18.3h0.39c0.44-5.97,1.27-11.9,2.48-17.76l18.99-97.6h27.02l-33.36,141.13H157.1l-22.62-93.47c-0.65-2.69-1.4-6.2-2.23-10.53s-1.33-7.48-1.54-9.47h-0.39c-0.26,2.3-0.77,5.71-1.54,10.23c-0.76,4.52-1.37,7.87-1.83,10.04l-21.27,93.17h-32.1L40.04,185.46h27.5l20.68,98.69C88.7,286.17,89.14,288.87,89.56,292.21z"/>
      </svg>
    `;
    const icon = fileType === "PDF" ? pdfIcon : docIcon;

    const chatBubble = document.createElement("li");
    chatBubble.className = "mb-10 ms-6 chat-bubble";
    chatBubble.innerHTML = `
      <span class="absolute flex items-center justify-center w-7 h-7 bg-blue-100 rounded-full -start-3 ring-8 ring-white dark:ring-gray-900 dark:bg-blue-900 text-sm font-medium text-gray-900 dark:text-white roll-number">
        ${rollNumber}
      </span>
      <div class="p-4 bg-white border border-gray-200 rounded-lg shadow-xs dark:bg-gray-700 dark:border-gray-600 cursor-pointer relative group" style="border-radius: 30px;">
        <div class="items-center justify-between mb-3 sm:flex">
          <time class="mb-1 text-xs font-normal text-gray-400 sm:order-last sm:mb-0"><span class="bg-blue-100 text-blue-800 text-xs font-medium inline-flex items-center px-2.5 py-0.5 rounded-sm dark:bg-gray-700 dark:text-blue-400 border border-blue-400" style="border-radius: 30px;">
<svg class="w-2.5 h-2.5 me-1.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
<path d="M10 0a10 10 0 1 0 10 10A10.011 10.011 0 0 0 10 0Zm3.982 13.982a1 1 0 0 1-1.414 0l-3.274-3.274A1.012 1.012 0 0 1 9 10V6a1 1 0 0 1 2 0v3.586l2.982 2.982a1 1 0 0 1 0 1.414Z"/>
</svg>
${time}
</span></time>
          <div class="text-sm font-normal text-gray-500 lex dark:text-gray-300">
            <a href="#" class="font-semibold text-gray-900 dark:text-white hover:underline">${fileId}</a>
          </div>
        </div>
        <div class="p-3 text-xs italic font-normal text-gray-500 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300" style="border-radius: 30px;">
          <div class="flex items-start gap-2.5">
            <div class="flex flex-col gap-2.5">
              <div class="leading-1.5 flex w-full max-w-[400px] flex-col">
                <div class="flex items-start bg-gray-50 dark:bg-gray-700 rounded-xl p-2" style="height: 76px; width: 216px; padding-top: 10px;">
                  <div class="me-2">
                    <span class="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white pb-2">
                      ${icon}
                      <span class="experiment-number">${experimentNumber}</span>
                    </span>
                    <span class="flex text-xs font-normal text-gray-500 dark:text-gray-400 gap-2">
                      <span class="file-size">${size}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="self-center" width="3" height="4" viewBox="0 0 3 4" fill="none">
                        <circle cx="1.5" cy="2" r="1.5" fill="#6B7280"></circle>
                      </svg>
                      <span class="file-type">${fileType}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <button class="absolute top-2 right-2 hidden group-hover:block text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200" onclick="downloadFileFromGDrive('${file.id}', '${file.name}')">
              <svg class="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 15v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12m0 0-4-4m4 4 4-4"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    chatBubble.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      openFilePreview(file);
    });
    chatBubble.addEventListener("click", (e) => {
      if (!e.target.closest("a")) {
        openFilePreview(file);
      }
    });
    ol.appendChild(chatBubble);
  });
}

// Open file preview modal
async function openFilePreview(file) {
  currentFileId = file.id;
  previewFilename.textContent = file.name;
  previewModal.classList.remove("hidden");
  pdfContainer.classList.add("hidden");
  docxContainer.classList.add("hidden");
  docPreviewIframe.classList.add("hidden");
  previewError.classList.add("hidden");
  previewLoading.classList.remove("hidden");
  docPreviewIframe.src = "";
  currentFileBlob = null;

  const fileExtension = file.name.split(".").pop().toLowerCase();
  try {
    if (fileCache[file.id]) {
      currentFileBlob = fileCache[file.id].blob;
      if (fileExtension === "pdf") {
        printButton.classList.add("hidden");
        docPreviewIframe.src = currentFileBlob;
      } else if (fileExtension === "doc" || fileExtension === "docx") {
        printButton.classList.remove("hidden");
        docPreviewIframe.src = `https://docs.google.com/document/d/${file.id}/preview?tab=t.0`;
      }
      previewLoading.classList.add("hidden");
      docPreviewIframe.classList.remove("hidden");
    } else {
      if (fileExtension === "pdf") {
        printButton.classList.add("hidden");
        await previewPdfFile(file);
      } else if (fileExtension === "doc" || fileExtension === "docx") {
        printButton.classList.remove("hidden");
        await previewDocFile(file);
      } else {
        printButton.classList.remove("hidden");
        showPreviewError("Unsupported file type");
      }
    }
  } catch (error) {
    console.error("Error opening file preview:", error);
    showPreviewError("Error loading file");
  }
}

// Preview PDF file using data URI
async function previewPdfFile(file) {
  try {
    const fileContent = await fetchFileContent(file.id);
    if (!fileContent) throw new Error("Failed to fetch file content");
    currentFileBlob = `data:application/pdf;base64,${fileContent}`;
    fileCache[file.id] = { blob: currentFileBlob, mimeType: "application/pdf" };
    console.log(`${file.name} cached`);
    docPreviewIframe.src = currentFileBlob;
    docPreviewIframe.addEventListener(
      "load",
      () => {
        previewLoading.classList.add("hidden");
        docPreviewIframe.classList.remove("hidden");
      },
      { once: true }
    );
  } catch (error) {
    console.error("Error previewing PDF:", error);
    showPreviewError("Error loading PDF");
  }
}

// Preview DOC/DOCX file using Google Docs preview
async function previewDocFile(file) {
  try {
    docPreviewIframe.src = `https://docs.google.com/document/d/${file.id}/preview?tab=t.0`;
    fileCache[file.id] = {
      blob: docPreviewIframe.src,
      mimeType: file.mimeType,
    };
    console.log(`${file.name} cached`);
    docPreviewIframe.addEventListener(
      "load",
      () => {
        previewLoading.classList.add("hidden");
        docPreviewIframe.classList.remove("hidden");
      },
      { once: true }
    );
  } catch (error) {
    console.error("Error previewing DOC file:", error);
    showPreviewError("Error loading document");
  }
}

// Show preview error
function showPreviewError(message) {
  previewLoading.classList.add("hidden");
  previewError.classList.remove("hidden");
  errorMessage.textContent = message || "Unable to preview file";
}

// Print the current file
async function printFile() {
  const fileExtension = previewFilename.textContent
    .split(".")
    .pop()
    .toLowerCase();
  if (fileExtension === "doc" || fileExtension === "docx") {
    if (!currentFileId) {
      console.error("Print failed: currentFileId is not set");
      alert("Please wait for the document to load before printing");
      return;
    }

    const printUrl = `https://docs.google.com/document/d/${currentFileId}/preview?tab=t.0`;
    const printWindow = window.open(printUrl, "_blank");
    if (!printWindow) {
      alert("Please allow pop-ups to print the document");
      return;
    }

    printWindow.addEventListener(
      "load",
      () => {
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
            printWindow.close();
          } catch (e) {
            console.error("Error during print operation:", e);
            alert(
              "Failed to print document. Please try printing manually from the preview."
            );
          }
        }, 2000);
      },
      { once: true }
    );

    setTimeout(() => {
      if (printWindow.document.readyState !== "complete") {
        alert(
          "Failed to load document for printing. Please try printing manually."
        );
        printWindow.close();
      }
    }, 10000);
  } else {
    alert("Printing is not supported for this file type");
  }
}

// Download the current file
function downloadFile() {
  if (currentFileId) {
    downloadFileFromGDrive(currentFileId, previewFilename.textContent);
  }
}

// Download a file from Google Drive
async function downloadFileFromGDrive(fileId, fileName) {
  try {
    const content = await fetchFileContent(fileId);
    if (!content) throw new Error("Failed to fetch file content");
    const byteCharacters = atob(content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const fileExtension = fileName.split(".").pop().toLowerCase();
    const mimeType =
      {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }[fileExtension] || "application/octet-stream";
    const blob = new Blob([byteArray], { type: mimeType });
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  } catch (error) {
    console.error("Error downloading file:", error);
    alert("Failed to download file. Please try again.");
  }
}

// Show error message in a container
function showErrorMessage(container, message) {
  container.innerHTML = `
    <div class="p-4 text-center">
      <i class="fas fa-exclamation-circle text-red-500 text-2xl mb-2"></i>
      <p class="text-gray-700">${message}</p>
    </div>
  `;
}

// API functions to communicate with Google Apps Script
async function fetchFolders(folderId) {
  try {
    const response = await fetch(
      `${APPS_SCRIPT_URL}?action=getFolders&folderId=${folderId}`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.folders || [];
  } catch (error) {
    console.error("Error fetching folders:", error);
    throw error;
  }
}

async function fetchFiles(folderId) {
  try {
    const response = await fetch(
      `${APPS_SCRIPT_URL}?action=getFiles&folderId=${folderId}`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.files || [];
  } catch (error) {
    console.error("Error fetching files:", error);
    throw error;
  }
}

async function fetchFileContent(fileId) {
  try {
    const response = await fetch(
      `${APPS_SCRIPT_URL}?action=getFileContent&fileId=${fileId}`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.content;
  } catch (error) {
    console.error("Error fetching file content:", error);
    throw error;
  }
}

async function fetchTemporaryUrl(fileId) {
  try {
    const response = await fetch(
      `${APPS_SCRIPT_URL}?action=getTemporaryUrl&fileId=${fileId}`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return { url: data.url, expires: data.expires };
  } catch (error) {
    console.error("Error fetching temporary URL:", error);
    throw error;
  }
}

async function revokeTemporaryAccess(fileId) {
  try {
    const response = await fetch(
      `${APPS_SCRIPT_URL}?action=revokeTemporaryAccess&fileId=${fileId}`,
      { method: "POST" }
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.success;
  } catch (error) {
    console.error("Error revoking temporary access:", error);
    throw error;
  }
}
