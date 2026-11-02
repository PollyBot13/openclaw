import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createAnswerLensHandlers } from "./src/backend.js";

export default definePluginEntry({
  id: "answer-lens",
  name: "Answer Lens",
  description:
    "Adjust an answer's length and wording in a sidebar without changing the conversation.",
  register(api) {
    const handlers = createAnswerLensHandlers((params) => api.runtime.llm.complete(params));
    api.registerGatewayMethod("answer-lens.sources", handlers.sources, { scope: "operator.read" });
    api.registerGatewayMethod("answer-lens.transform", handlers.transform, {
      scope: "operator.write",
      sessionAccess: { mode: "write" },
    });
  },
});
