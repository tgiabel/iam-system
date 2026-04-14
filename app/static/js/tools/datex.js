document.addEventListener("DOMContentLoaded", () => {
    const dropArea = document.getElementById("dropArea");
    const fileInput = document.getElementById("fileInput");
    const fileNameValue = document.querySelector("#fileName .report-meta-value");

    if (!dropArea || !fileInput || !fileNameValue) {
        return;
    }

    const updateFileName = (file) => {
        fileNameValue.textContent = file ? file.name : "Keine Datei ausgewählt";
    };

    dropArea.addEventListener("click", () => fileInput.click());
    dropArea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInput.click();
        }
    });

    dropArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropArea.classList.add("open");
    });

    dropArea.addEventListener("dragleave", () => {
        dropArea.classList.remove("open");
    });

    dropArea.addEventListener("drop", (event) => {
        event.preventDefault();
        dropArea.classList.remove("open");

        if (!event.dataTransfer?.files?.length) {
            return;
        }

        fileInput.files = event.dataTransfer.files;
        updateFileName(event.dataTransfer.files[0]);
    });

    fileInput.addEventListener("change", () => {
        updateFileName(fileInput.files?.[0]);
    });
});
