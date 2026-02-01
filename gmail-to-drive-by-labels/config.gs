// --- CONFIGURATION SECTION ---

// This function returns the configuration array.
// Edit the values inside the quotes below.
function getProcessConfig() {
  return [
    {
      triggerLabel: "label`",
      processedLabel: "label-archived",
      docId: "GUID", // Text goes here
      folderId: "GUID" // Attachments go here
    },
    {
      triggerLabel: "nested-label/label`",
      processedLabel: "nested-label/label-archived",
      docId: "GUID", // Text goes here
      folderId: "GUID" // Attachments go here
    }
  ];
}
