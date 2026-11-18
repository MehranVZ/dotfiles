return {
  enabled = false,
  "barrett-ruth/live-server.nvim",
  opts = {
    build = "npm install -g live-server",
    cmd = { "LiveServerStart", "LiveServerStop" },
    config = true,
  },
}
