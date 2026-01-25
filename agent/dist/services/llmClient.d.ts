/**
 * LLM Client Service
 * Supports OpenAI, Anthropic, or stub mode
 */
export interface LlmChatInput {
    systemPrompt: string;
    userPrompt: string;
}
export interface LlmChatOutput {
    assistantMessage: string;
    rawJson: string;
}
/**
 * Call LLM with structured JSON output
 */
export declare function callLlm(input: LlmChatInput): Promise<LlmChatOutput>;
//# sourceMappingURL=llmClient.d.ts.map