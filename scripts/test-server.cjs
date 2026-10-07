// Local offline Minecraft server for development (pure JS, no Mojang download).
// Usage: node scripts/test-server.cjs [version] [port]
const mcServer = require('flying-squid')

function start ({ version = '1.21.4', port = 25565 } = {}) {
  return mcServer.createMCServer({
    motd: 'mc-parallel-agent test server',
    port,
    'max-players': 10,
    'online-mode': false,
    logging: false,
    gameMode: 0,
    difficulty: 0,
    generation: { name: 'superflat', options: { worldHeight: 80 } },
    kickTimeout: 60000,
    plugins: {},
    modpe: false,
    'view-distance': 4,
    'player-list-text': { header: '', footer: '' },
    'everybody-op': true,
    'max-entities': 50,
    version
  })
}

module.exports = { start }

if (require.main === module) {
  const [version, port] = process.argv.slice(2)
  start({ version, port: port ? Number(port) : undefined })
  console.log(`test server on port ${port || 25565}`)
}
