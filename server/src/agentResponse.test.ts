import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentActionTypeValues, agentIntentValues } from "@twinops/shared";
import {
  assistantWelcomeAgentResponse,
  fallbackAgentResponse,
  fallbackAgentResponseFor,
  isAssistantIntroductionQuery
} from "./agentResponse";

describe("assistant introduction", () => {
  it("recognises greetings and capability questions without treating operational queries as greetings", () => {
    assert.equal(isAssistantIntroductionQuery("Hello"), true);
    assert.equal(isAssistantIntroductionQuery("What can you do?"), true);
    assert.equal(isAssistantIntroductionQuery("Introduce yourself"), true);
    assert.equal(isAssistantIntroductionQuery("Check Cold Storage temperature status"), false);
  });

  it("returns a useful persona introduction with an example question", () => {
    const response = assistantWelcomeAgentResponse();

    assert.equal(response.intent, "general_question");
    assert.equal(response.status, "ok");
    assert.equal(response.confidence, "high");
    assert.match(response.summary, /TwinOps Control/);
    assert.ok(response.facts.some((fact) => fact.label === "Example question" && fact.value.endsWith("?")));
    assert.deepEqual(response.dataGaps, []);
  });

  it("keeps genuine missing operational evidence on the unavailable fallback", () => {
    assert.equal(fallbackAgentResponse.status, "unavailable");
    assert.equal(fallbackAgentResponse.title, "I Couldn't Verify This");
    assert.match(fallbackAgentResponse.summary, /have not guessed/i);

    const toolFailure = fallbackAgentResponseFor("Required deterministic tool output was unavailable.");
    assert.match(toolFailure.dataGaps[0], /warehouse lookup/i);
  });
});

describe("read-only assistant contract", () => {
  it("does not expose approval intents or actions", () => {
    assert.ok(!agentIntentValues.includes("approval_required" as never));
    assert.ok(!agentActionTypeValues.includes("request_approval" as never));
  });
});
