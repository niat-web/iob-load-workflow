import { useCallback } from "react";
import { useToast } from "../components/toast-context";

export function useCopyToClipboard() {
  const toast = useToast();
  return useCallback(
    async (text: string, successMessage = "Link copied") => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
        return true;
      } catch {
        toast.error("Could not copy to the clipboard");
        return false;
      }
    },
    [toast],
  );
}
