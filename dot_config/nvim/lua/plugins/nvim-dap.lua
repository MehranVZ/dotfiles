return {
  {
    "mfussenegger/nvim-dap",
    optional = true,
    -- nvim-dap-cortex-debug wires up the `cortex-debug` DAP adapter correctly:
    -- its enrich_config/verify_config inject the launch-config defaults that
    -- VS Code would normally supply (searchDir, serverArgs, swoConfig, rttConfig,
    -- openOCDLaunchCommands, ...). nvim-dap does NOT inject those, which is why
    -- the bare `node debugadapter.js` adapter crashed with
    -- `Cannot read properties of undefined (reading 'forEach')` at serverArguments.
    -- It also handles the custom DAP events (ports-allocated, etc.) and RTT.
    -- dependencies = {
    --   {
    --     "jedrzejboczar/nvim-dap-cortex-debug",
    --     config = function()
    --       require("dap-cortex-debug").setup({
    --         debug = false,
    --         -- Pin to the Mason-installed extension (`:MasonInstall cortex-debug`)
    --         -- so detection doesn't depend on $MASON / the ~/.vscode copy.
    --         extension_path = vim.fn.stdpath("data") .. "/mason/packages/cortex-debug/extension/",
    --         node_path = "node",
    --         dapui_rtt = true,
    --         -- Map launch.json `"type": "cortex-debug"` entries into the c/cpp
    --         -- config buckets that <leader>dc reads from.
    --         dap_vscode_filetypes = { "c", "cpp" },
    --         rtt = { buftype = "Terminal" },
    --       })
    --     end,
    --   },
    -- },
    keys = {
      -- Override Run/Continue so the generic global configs ("Launch file",
      -- "LLDB: Launch", ...) are dropped and ONLY the project's
      -- .vscode/launch.json drives the picker.
      {
        "<leader>dc",
        function()
          for _, ft in ipairs({ "c", "cpp" }) do
            require("dap").configurations[ft] = {}
          end
          require("dap").continue()
        end,
        desc = "Run/Continue",
      },
    },
  },
}
