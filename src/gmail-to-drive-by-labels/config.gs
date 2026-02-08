// --- CONFIGURATION SECTION ---

// This function returns the configuration array.
// Edit the values inside the quotes below.
function getProcessConfig() {
  return [
    {
      triggerLabel: "label`",
      processedLabel: "label-archived",
      docId: "GUID", // Text goes here
      folderId: "GUID", // Attachments go here
      batchSize: 250 // Optional: Number of threads to process per batch during rebuild (default: 250)
    },
    {
      triggerLabel: "nested-label/label`",
      processedLabel: "nested-label/label-archived",
      docId: "GUID", // Text goes here
      folderId: "GUID" // Attachments go here
      // batchSize: 250 // Optional: can be omitted to use default
    }
  ];
}
