return {
  "neovim/nvim-lspconfig",
  opts = {
    servers = {
      clangd = {
        cmd = {
          "clangd",
          "--background-index",
          "--clang-tidy",
          "--header-insertion=never",
          "--completion-style=detailed",
          "--function-arg-placeholders",
          "--fallback-style=llvm",
        },
        init_options = {
          provideFormatter = false,
        },
      },
      rust_analyzer = { init_options = { provideFormatter = false } },
      html = { init_options = { provideFormatter = false } },
      cssls = { init_options = { provideFormatter = false } },
      buf_ls = { init_options = { provideFormatter = false } },
    },
  },
}
