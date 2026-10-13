# 去掉 Windows 计划任务 HuduiGroup 的执行时长上限（PT0S = 不限时）。
# 计划任务默认 3 天后会被强制结束，服务端进程会被连带杀掉；跑一次即可。
# 用法：pwsh -File scripts/remove-task-time-limit.ps1 [-TaskName HuduiGroup]
param(
  [string]$TaskName = 'HuduiGroup'
)

$t = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$t.Settings.ExecutionTimeLimit = 'PT0S'
Set-ScheduledTask -InputObject $t | Out-Null
(Get-ScheduledTask -TaskName $TaskName).Settings.ExecutionTimeLimit
