import { expect, it } from 'vitest'
import { readBody, readJson } from './response.js'

const chunked = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
  )

it('joins chunks into one exact buffer and rejects bodies over the bound', async () => {
  const bytes = await readBody(chunked('ab', 'cd', 'e'), 5)
  expect(new TextDecoder().decode(bytes)).toBe('abcde')
  expect(bytes.buffer.byteLength).toBe(5)
  await expect(readBody(chunked('ab', 'cd', 'ef'), 5)).rejects.toThrow('limit')
})

it('parses bounded strict UTF-8 JSON', async () => {
  expect(await readJson(chunked('{"a":', '[1]}'), 16)).toEqual({ a: [1] })
  await expect(readJson(chunked('{"a":"', 'x'.repeat(16), '"}'), 16)).rejects.toThrow('limit')
  await expect(readJson(new Response(new Uint8Array([0x22, 0xff, 0x22])), 16)).rejects.toThrow()
  await expect(readJson(chunked('{'), 16)).rejects.toThrow(SyntaxError)
})
