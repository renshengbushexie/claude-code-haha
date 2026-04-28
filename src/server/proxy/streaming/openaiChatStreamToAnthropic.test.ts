import { describe, expect, it } from 'bun:test'
import { openaiChatStreamToAnthropic } from './openaiChatStreamToAnthropic'

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

// Read converted stream fully and split into Anthropic SSE event names (in order).
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  const events: string[] = []
  for (const line of buf.split('\n')) {
    const m = line.match(/^event:\s*(\S+)/)
    if (m) events.push(m[1]!)
  }
  return events
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
