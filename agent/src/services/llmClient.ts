/**
 * LLM Client Service
 * Supports OpenAI, Anthropic, or stub mode
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface LlmChatInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface LlmChatOutput {
  assistantMessage: string;
  rawJson: string; // the JSON the model returned for actions
}

type ModelProvider = 'openai' | 'anthropic' | 'gemini' | 'stub';

function getProvider(): ModelProvider {
  const provider = process.env.BLOSSOM_MODEL_PROVIDER as ModelProvider;
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    return provider;
  }
  return 'stub';
}

/**
 * Call LLM with structured JSON output
 */
export async function callLlm(input: LlmChatInput): Promise<LlmChatOutput> {
  const provider = getProvider();
  console.log('[llmClient] Using provider:', provider);

  if (provider === 'stub') {
    return {
      assistantMessage: "This is a stubbed Blossom response. No real AI model is configured. Set BLOSSOM_MODEL_PROVIDER and API keys to enable real AI.",
      rawJson: JSON.stringify({
        assistantMessage: "This is a stubbed Blossom response. No real AI model is configured.",
        actions: []
      })
    };
  }

  if (provider === 'openai') {
    return callOpenAI(input);
  }

  if (provider === 'anthropic') {
    return callAnthropic(input);
  }

  if (provider === 'gemini') {
    return callGemini(input);
  }

  // Fallback to stub
  return {
    assistantMessage: "LLM provider not configured correctly.",
    rawJson: JSON.stringify({ assistantMessage: "Error", actions: [] })
  };
}

/**
 * Call OpenAI API
 */
async function callOpenAI(input: LlmChatInput): Promise<LlmChatOutput> {
  const apiKey = process.env.BLOSSOM_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('BLOSSOM_OPENAI_API_KEY is not set');
  }

  const model = process.env.BLOSSOM_OPENAI_MODEL || 'gpt-4o-mini';
  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    return {
      assistantMessage: '', // Will be extracted from JSON
      rawJson: content,
    };
  } catch (error: any) {
    console.error('OpenAI API error:', error.message);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Call Anthropic API
 */
async function callAnthropic(input: LlmChatInput): Promise<LlmChatOutput> {
  const apiKey = process.env.BLOSSOM_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('BLOSSOM_ANTHROPIC_API_KEY is not set');
  }

  const model = process.env.BLOSSOM_ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  const client = new Anthropic({ apiKey });

  try {
    // Anthropic requires JSON in the system prompt or user message
    const enhancedSystemPrompt = `${input.systemPrompt}\n\nYou MUST respond with ONLY a valid JSON object, no other text before or after.`;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: enhancedSystemPrompt,
      messages: [
        { role: 'user', content: input.userPrompt }
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected content type from Anthropic');
    }

    const text = content.text.trim();
    
    // Extract JSON if wrapped in markdown code blocks
    let jsonText = text;
    if (text.startsWith('```json')) {
      jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (text.startsWith('```')) {
      jsonText = text.replace(/```\n?/g, '').trim();
    }

    return {
      assistantMessage: '', // Will be extracted from JSON
      rawJson: jsonText,
    };
  } catch (error: any) {
    console.error('Anthropic API error:', error.message);
    throw new Error(`Anthropic API error: ${error.message}`);
  }
}

/**
 * Call Google Gemini API
 */
async function callGemini(input: LlmChatInput): Promise<LlmChatOutput> {
  const apiKey = process.env.BLOSSOM_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[llmClient] Gemini key missing, falling back to stub');
    // Fall back to stub instead of throwing error
    return {
      assistantMessage: "This is a stubbed Blossom response. Gemini API key not configured. Set BLOSSOM_GEMINI_API_KEY to enable Gemini.",
      rawJson: JSON.stringify({
        assistantMessage: "This is a stubbed Blossom response. Gemini API key not configured.",
        actions: []
      })
    };
  }

  const model = process.env.BLOSSOM_GEMINI_MODEL || 'gemini-1.5-pro';
  
  try {
    // Gemini API endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${input.systemPrompt}\n\n${input.userPrompt}\n\nYou MUST respond with ONLY a valid JSON object, no other text before or after.` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('No content in Gemini response');
    }

    // Extract JSON if wrapped in markdown code blocks
    let jsonText = content.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '').trim();
    }

    return {
      assistantMessage: '', // Will be extracted from JSON
      rawJson: jsonText,
    };
  } catch (error: any) {
    console.error('Gemini API error:', error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

