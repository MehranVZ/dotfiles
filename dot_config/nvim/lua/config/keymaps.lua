-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Escape sequence
vim.keymap.set("i", "jk", "<ESC>", { desc = "Escape" })
vim.keymap.set("t", "<C-;>", [[<C-\><C-n>]], { desc = "Escape terminal mode" })

-- Toggle zoom (same as <leader>uZ) in all modes
vim.keymap.set({ "n", "i", "v", "t" }, "<C-,>", function()
  Snacks.zen.zoom()
end, { desc = "Toggle Zoom" })

-- DAP
vim.keymap.set("n", "<F4>", "<leader>db", { desc = "Toggle Breakpoint" })
vim.keymap.set("n", "<F5>", "<leader>dc", { desc = "Run/Continue" })
vim.keymap.set("n", "<F6>", "<leader>di", { desc = "Step Into" })
vim.keymap.set("n", "<F7>", "<leader>dO", { desc = "Step Over" })
vim.keymap.set("n", "<F8>", "<leader>do", { desc = "Step Out" })
