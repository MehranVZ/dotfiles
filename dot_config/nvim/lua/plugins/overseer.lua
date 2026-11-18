return {
  {
    "stevearc/overseer.nvim",
    -- Remap two LazyVim editor.overseer keys: ow->ol (list), ot->oa (action).
    -- stylua: ignore
    keys = {
      { "<leader>ow", false },
      { "<leader>ol", "<cmd>OverseerToggle!<cr>",    desc = "Task list" },
      { "<leader>ot", false },
      { "<leader>oa", "<cmd>OverseerTaskAction<cr>", desc = "Task action" },
    },
    -- VS Code tasks default to inline diagnostics, which go stale after a
    -- rebuild. Route build errors to the quickfix list instead.
    opts = {
      component_aliases = {
        default_vscode = {
          "default",
          { "on_result_diagnostics_quickfix", open = true, close = true },
        },
      },
    },
  },
}
