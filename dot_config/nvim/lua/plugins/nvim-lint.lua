-- To check the running linters do -> :lua print(vim.inspect(require('lint').linters_by_ft))
return {
  "mfussenegger/nvim-lint",
  opts = {
    linters_by_ft = {
      markdown = {}, -- disables all linters for markdown
    },
  },
}
