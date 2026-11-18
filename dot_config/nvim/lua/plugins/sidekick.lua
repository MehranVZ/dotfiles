local cwd = vim.fn.getcwd()

return {
  "folke/sidekick.nvim",
  opts = {
    copilot = {
      status = { enabled = false },
    },
    cli = {
      win = {
        split = {
          width = 88,
        },
        keys = {
          buffers = { "<c-b>", "buffers", mode = "n", desc = "open buffer picker" },
          files = { "<c-f>", "files", mode = "n", desc = "open file picker" },
          prompt = { "<c-p>", "prompt", mode = "n", desc = "insert prompt or context" },
        },
      },
      tools = {
        opencode = {
          keys = {
            prompt = false,
          },
        },
        -- capitalized so it sorts first in the picker (ties break by name, uppercase before lowercase)
        ["Claude agents view"] = { cmd = { "claude", "agents", "--cwd", "." } },
        claude = { cmd = { "claude" } },
        codex = { cmd = { "codex" } },
        qwen = { cmd = { "qwen" } },
        gemini = { cmd = { "gemini" } },
      },
    },
  },
}
