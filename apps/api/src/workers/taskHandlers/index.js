import { applicationWindowHandlers } from "./applicationWindow.js";
import { candidatePoolHandlers } from "./candidatePool.js";
import { dealProcessingHandlers } from "./dealProcessing.js";
import { hubspotUpdateHandlers } from "./hubspotUpdate.js";
import { notificationHandlers } from "./notifications.js";
import { postLoadHandlers } from "./postLoad.js";

export const taskHandlers = {
  ...dealProcessingHandlers,
  ...applicationWindowHandlers,
  ...candidatePoolHandlers,
  ...notificationHandlers,
  ...hubspotUpdateHandlers,
  ...postLoadHandlers,
};
