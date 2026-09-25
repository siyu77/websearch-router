param([string]$Tooltip, [string]$IconPath)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
# Custom teal WR icon, loaded via -IconPath (DIB multi-size .ico). Any load
# failure (missing / corrupt / wrong format) must degrade to the system icon
# instead of terminating the script ($ErrorActionPreference = "Stop" above).
if ($IconPath) {
  try { $script:notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath) }
  catch { $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Application }
} else {
  $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$script:notifyIcon.Text = $Tooltip
$script:notifyIcon.Visible = $true
$script:menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:notifyIcon.ContextMenuStrip = $script:menu
$script:items = @()

function Write-Event($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Add-MenuItem($index, $title, $enabled, $checked) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $title
  $item.Enabled = $enabled
  if ($checked) { $item.Checked = $true }
  $idx = $index
  $item.Add_Click({ Write-Event @{ type = "click"; index = $idx } }.GetNewClosure())
  $script:menu.Items.Add($item) | Out-Null
  $script:items += $item
}
function Update-MenuItem($index, $title, $enabled, $checked) {
  $item = $script:menu.Items[$index]
  if ($title -ne $null) { $item.Text = $title }
  $item.Enabled = $enabled
  if ($checked -ne $null) { $item.Checked = $checked }
}
function Set-Tooltip($text) { $script:notifyIcon.Text = $text }

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 100
$script:timer.Add_Tick({
  try {
    while ([Console]::In.Peek() -ne -1) {
      $line = [Console]::In.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cmd = $line | ConvertFrom-Json
      switch ($cmd.action) {
        "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled $cmd.checked }
        "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled $cmd.checked }
        "set-tooltip" { Set-Tooltip $cmd.text }
        "ready"       { Write-Event @{ type = "ready" } }
        "kill"        { $script:notifyIcon.Visible = $false; $script:notifyIcon.Dispose(); [System.Windows.Forms.Application]::Exit() }
      }
    }
  } catch { Write-Event @{ type = "error"; message = $_.Exception.Message } }
})
$script:timer.Start()
Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()