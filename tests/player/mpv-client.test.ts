import { afterEach, describe, expect, it } from 'vitest'
import { MpvClient } from '../../src/main/player/mpv-client'
import { FakeMpv, uniquePipePath } from '../helpers/fake-mpv'
import { sleep, waitFor } from '../helpers/wait'

let fake: FakeMpv | undefined
let client: MpvClient | undefined
afterEach(async () => {
  client?.close()
  await fake?.close()
  fake = undefined
  client = undefined
})

async function setup(): Promise<{ fake: FakeMpv; client: MpvClient }> {
  fake = await FakeMpv.start()
  client = await MpvClient.connect(fake.path)
  client.start()
  await waitFor(() => fake!.clientCount > 0) // o connect resolve antes de o servidor registrar a conexão
  return { fake, client }
}

describe('MpvClient', () => {
  it('command resolve com o dado da resposta', async () => {
    const { fake, client } = await setup()
    fake.props.set('duration', 1380.5)
    expect(await client.getProperty('duration')).toBe(1380.5)
  })

  it('command rejeita com o texto de erro do mpv', async () => {
    const { client } = await setup()
    await expect(client.getProperty('nao-existe')).rejects.toThrow('property unavailable')
  })

  it('setProperty chega ao mpv com os argumentos certos', async () => {
    const { fake, client } = await setup()
    await client.setProperty('sid', 3)
    expect(fake.commands).toContainEqual(['set_property', 'sid', 3])
  })

  it('observe entrega o valor atual e as mudanças como evento "property"', async () => {
    const { fake, client } = await setup()
    fake.props.set('time-pos', 10)
    const got: [string, unknown][] = []
    client.on('property', (name: string, data: unknown) => got.push([name, data]))
    await client.observe('time-pos')
    fake.setProp('time-pos', 15)
    await waitFor(() => got.length === 2)
    expect(got).toEqual([['time-pos', 10], ['time-pos', 15]])
  })

  it('eventos que não são de propriedade saem em "event"', async () => {
    const { fake, client } = await setup()
    const events: Record<string, unknown>[] = []
    client.on('event', (m: Record<string, unknown>) => events.push(m))
    fake.emitEvent({ event: 'end-file', reason: 'eof' })
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({ event: 'end-file', reason: 'eof' })
  })

  it('eventos enviados antes de start() não se perdem', async () => {
    fake = await FakeMpv.start()
    client = await MpvClient.connect(fake.path)
    await sleep(30) // dá tempo de o servidor registrar a conexão antes de transmitir
    fake.emitEvent({ event: 'playback-restart' })
    await sleep(30)
    const events: Record<string, unknown>[] = []
    client.on('event', (m: Record<string, unknown>) => events.push(m))
    client.start()
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({ event: 'playback-restart' })
  })

  it('quando o mpv cai: emite "close", rejeita o que estava pendente e os próximos comandos', async () => {
    const { fake, client } = await setup()
    fake.silentCommands.add('get_property')
    let closed = false
    client.on('close', () => (closed = true))
    const pending = client.getProperty('duration')
    const assertion = expect(pending).rejects.toThrow('mpv desconectado')
    fake.dropClients()
    await assertion
    await waitFor(() => closed)
    await expect(client.getProperty('duration')).rejects.toThrow('mpv desconectado')
  })

  it('comando sem resposta estoura o tempo limite', async () => {
    fake = await FakeMpv.start()
    client = await MpvClient.connect(fake.path, { commandTimeoutMs: 50 })
    client.start()
    fake.silentCommands.add('get_property')
    await expect(client.getProperty('duration')).rejects.toThrow('mpv não respondeu')
  })

  it('connect tenta de novo até o mpv criar o pipe', async () => {
    const path = uniquePipePath()
    const connecting = MpvClient.connect(path, { delayMs: 20, retries: 100 })
    await sleep(120)
    fake = await FakeMpv.start(path)
    client = await connecting
    client.start()
    fake.props.set('pause', true)
    expect(await client.getProperty('pause')).toBe(true)
  })

  it('connect desiste quando shouldAbort manda (o processo do mpv já morreu)', async () => {
    const t0 = Date.now()
    await expect(MpvClient.connect(uniquePipePath(), { delayMs: 10, retries: 1000, shouldAbort: () => true })).rejects.toThrow('não foi possível conectar ao mpv')
    expect(Date.now() - t0).toBeLessThan(500)
  })
})
