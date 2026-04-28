import { describe, expect, it } from 'bun:test'
import { openaiChatStreamToAnthropic } from './openaiChatStreamToAnthropic'

type AnthropicSseEvent = {
  event: string
  data: Record<string, unknown>
}

// Build a single OpenAI Chat Completions chunk with the given delta and optional finish_reason.
function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  const obj = {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
  return `data: ${JSON.stringify(obj)}\n\n`
}

// Build a ReadableStream<Uint8Array> from a list of SSE text segments.
function makeUpstream(segments: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const seg of segments) controller.enqueue(enc.encode(seg))
      controller.close()
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  return buf
}

async function collectSseEvents(stream: ReadableStream<Uint8Array>): Promise<AnthropicSseEvent[]> {
  const buf = await readStream(stream)
  const events: AnthropicSseEvent[] = []

  for (const rawEvent of buf.split('\n\n')) {
    if (!rawEvent.trim()) continue
    const lines = rawEvent.split('\n')
    const eventLine = lines.find((line) => line.startsWith('event: '))
    const dataLine = lines.find((line) => line.startsWith('data: '))
    if (!eventLine || !dataLine) continue

    const event = eventLine.slice(7)
    const parsed: unknown = JSON.parse(dataLine.slice(6))
    if (isRecord(parsed)) {
      events.push({ event, data: parsed })
    }
  }

  return events
}

// Read converted stream fully and split into Anthropic SSE event names (in order).
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const events = await collectSseEvents(stream)
  return events.map((event) => event.event)
}

function thinkingDeltas(events: AnthropicSseEvent[]): string[] {
  const result: string[] = []
  for (const event of events) {
    if (event.event !== 'content_block_delta') continue
    const delta = event.data.delta
    if (!isRecord(delta) || delta.type !== 'thinking_delta') continue
    if (typeof delta.thinking === 'string') result.push(delta.thinking)
  }
  return result
}

function textDeltas(events: AnthropicSseEvent[]): string[] {
  const result: string[] = []
  for (const event of events) {
    if (event.event !== 'content_block_delta') continue
    const delta = event.data.delta
    if (!isRecord(delta) || delta.type !== 'text_delta') continue
    if (typeof delta.text === 'string') result.push(delta.text)
  }
  return result
}

function contentBlockStartTypes(events: AnthropicSseEvent[]): string[] {
  const result: string[] = []
  for (const event of events) {
    if (event.event !== 'content_block_start') continue
    const contentBlock = event.data.content_block
    if (!isRecord(contentBlock)) continue
    if (typeof contentBlock.type === 'string') result.push(contentBlock.type)
  }
  return result
}

describe('openaiChatStreamToAnthropic — [DONE] terminator variants (regression for #204)', () => {
  it('handles canonical `data: [DONE]` (with space)', async () => {
    const upstream = makeUpstream([
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      'data: [DONE]\n\n',
    ])
    const events = await collectEvents(openaiChatStreamToAnthropic(upstream, 'm'))
    expect(events).toContain('message_start')
    expect(events).toContain('message_stop')
  })

  it('handles `data:[DONE]` without space (Azure / continuedev#5580)', async () => {
    const upstream = makeUpstream([
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      'data:[DONE]\n\n',
    ])
    const events = await collectEvents(openaiChatStreamToAnthropic(upstream, 'm'))
    expect(events).toContain('message_stop')
  })

  it('handles bare `[DONE]` line (LMStudio bug-tracker #676)', async () => {
    const upstream = makeUpstream([
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      '[DONE]\n\n',
    ])
    const events = await collectEvents(openaiChatStreamToAnthropic(upstream, 'm'))
    expect(events).toContain('message_stop')
  })

  it('finalizes when upstream closes without any [DONE] sentinel', async () => {
    const upstream = makeUpstream([
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      // no [DONE] — upstream just closes the stream
    ])
    const events = await collectEvents(openaiChatStreamToAnthropic(upstream, 'm'))
    expect(events).toContain('message_stop')
  })

  it('accepts data chunks with `data:` prefix lacking a space', async () => {
    const obj = {
      id: 'x',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }],
    }
    const upstream = makeUpstream([
      `data:${JSON.stringify(obj)}\n\n`,
      chunk({}, 'stop'),
      'data: [DONE]\n\n',
    ])
    const events = await collectEvents(openaiChatStreamToAnthropic(upstream, 'm'))
    expect(events).toContain('message_start')
    expect(events).toContain('content_block_start')
    expect(events).toContain('message_stop')
  })
})

describe('openaiChatStreamToAnthropic — reasoning/thinking loop prevention (regression for #74)', () => {
  it('deduplicates cumulative reasoning_content snapshots before emitting thinking_delta', async () => {
    const upstream = makeUpstream([
      chunk({ reasoning_content: 'first' }),
      chunk({ reasoning_content: 'first second' }),
      chunk({ reasoning_content: 'first second third' }),
      chunk({ content: 'done' }, 'stop'),
      'data: [DONE]\n\n',
    ])

    const events = await collectSseEvents(openaiChatStreamToAnthropic(upstream, 'm'))

    expect(thinkingDeltas(events).join('')).toBe('first second third')
  })

  it('does not reopen thinking after answer text has started', async () => {
    const upstream = makeUpstream([
      chunk({ reasoning_content: 'plan' }),
      chunk({ content: 'answer ' }),
      chunk({ reasoning_content: 'late provider reasoning' }),
      chunk({ content: 'done' }, 'stop'),
      'data: [DONE]\n\n',
    ])

    const events = await collectSseEvents(openaiChatStreamToAnthropic(upstream, 'm'))

    expect(contentBlockStartTypes(events).filter((type) => type === 'thinking')).toEqual(['thinking'])
    expect(thinkingDeltas(events)).toEqual(['plan'])
    expect(textDeltas(events).join('')).toBe('answer done')
  })
})
