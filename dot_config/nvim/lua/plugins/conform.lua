return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      rust = { "rustfmt", lsp_format = "disable" },
      c = { "clang-format", lsp_format = "disable" },
      cpp = { "clang-format", lsp_format = "disable" },
      cmake = { "cmake_format", lsp_format = "disable" },
      markdown = {},
    },
  },
}
