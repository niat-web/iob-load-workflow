import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById("status");
  if (status) status.textContent = "Sign-in could not finish. Close this window and try again.";
});
