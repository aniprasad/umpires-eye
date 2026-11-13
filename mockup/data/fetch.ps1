#requires -Version 7
<#
  Umpire's Eye - data builder.
  Fetches the five 2026 World Series game feeds from the MLB Stats API, extracts every called pitch
  (details.call.code 'C' or 'B'), reconstructs each trajectory from the 9-parameter fit, judges it
  against the 2026 ABS zone at mid-plate, recovers the umpire's original call for ABS-challenged pitches,
  validates, curates "Today's Ten", and writes pool.json + ten.json next to this script.

  Usage (from this folder):   pwsh -File fetch.ps1
  Optional: -CacheDir <dir>   read raw feeds from <dir> if present, otherwise fetch and save them there.
#>
param([string]$CacheDir = '')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # web cmdlets are much slower with the progress display on
[System.Threading.Thread]::CurrentThread.CurrentCulture = [cultureinfo]::InvariantCulture
$OutDir = $PSScriptRoot

# ---------------------------------------------------------------- constants
$Games = @(
  [ordered]@{ n = 1; pk = 849805 }, [ordered]@{ n = 2; pk = 849802 }, [ordered]@{ n = 3; pk = 849804 },
  [ordered]@{ n = 4; pk = 849803 }, [ordered]@{ n = 5; pk = 849799 }
)
$Y_FRONT   = 17.0 / 12.0           # front edge of plate (ft, y=0 is back tip)
$Y_MID     = 8.5 / 12.0            # middle of plate depth: ABS judging plane
$HALF_W_IN = 8.5                   # half plate width (in)
$BALL_R_IN = 1.45                  # ball radius (in)
$SOURCE    = "MLB Stats API, statsapi.mlb.com $([char]0x2014) personal, non-commercial mockup"

function Rnd([object]$v, [int]$d = 4) { if ($null -eq $v) { return $null }; [Math]::Round([double]$v, $d) }

# ---------------------------------------------------------------- fetch
function Get-Feed([long]$pk) {
  $url = "https://statsapi.mlb.com/api/v1.1/game/$pk/feed/live"
  if ($CacheDir) {
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    $f = Join-Path $CacheDir "$pk.json"
    if (-not (Test-Path $f)) {
      for ($i = 1; $i -le 3; $i++) {
        try { Invoke-WebRequest -Uri $url -OutFile $f -UseBasicParsing -TimeoutSec 60; break }
        catch { if ($i -eq 3) { throw }; Write-Host "  retry $i ($pk): $($_.Exception.Message)"; Start-Sleep -Seconds (2 * $i) }
      }
    }
    return Get-Content -Raw -Encoding utf8 $f | ConvertFrom-Json -Depth 100
  }
  for ($i = 1; $i -le 3; $i++) {
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 60 }
    catch { if ($i -eq 3) { throw }; Write-Host "  retry $i ($pk): $($_.Exception.Message)"; Start-Sleep -Seconds (2 * $i) }
  }
}

# ---------------------------------------------------------------- physics
# Constant-acceleration 9-parameter model, t = 0 at y0 (= 50 ft).
# Root of y0 + vY0 t + aY t^2 / 2 = Y nearest t = 0 (positive toward the plate, negative toward release).
function Get-TAtY($c, [double]$Y) {
  $k = [double]$c.y0 - $Y
  $disc = [double]$c.vY0 * [double]$c.vY0 - 2.0 * [double]$c.aY * $k
  return 2.0 * $k / (-[double]$c.vY0 + [Math]::Sqrt($disc))
}
function Get-PosAt($c, [double]$t) {
  [pscustomobject]@{
    x = [double]$c.x0 + [double]$c.vX0 * $t + 0.5 * [double]$c.aX * $t * $t
    y = [double]$c.y0 + [double]$c.vY0 * $t + 0.5 * [double]$c.aY * $t * $t
    z = [double]$c.z0 + [double]$c.vZ0 * $t + 0.5 * [double]$c.aZ * $t * $t
  }
}
# Signed margin (in): how far the ball must move to flip the call. >= 0 -> some part of the ball touches the zone.
# Exact disc-vs-rectangle geometry (rounded corners). Inputs in feet.
function Get-EdgeMargin([double]$x, [double]$z, [double]$top, [double]$bot, [double]$rIn = $BALL_R_IN) {
  $dx = [Math]::Abs($x * 12) - $HALF_W_IN
  $dz = [Math]::Max($bot * 12 - $z * 12, $z * 12 - $top * 12)
  $out = [Math]::Sqrt([Math]::Pow([Math]::Max($dx, 0), 2) + [Math]::Pow([Math]::Max($dz, 0), 2))
  $in = [Math]::Min([Math]::Max($dx, $dz), 0)
  return $rIn - ($out + $in)
}
function Test-BoxStrike([double]$x, [double]$z, [double]$top, [double]$bot, [double]$rIn = $BALL_R_IN) {
  $r = $rIn / 12.0
  return ([Math]::Abs($x) -le $HALF_W_IN / 12.0 + $r) -and ($z -ge $bot - $r) -and ($z -le $top + $r)
}
function Get-HeightFt([string]$h) {
  if ($h -match "(\d+)\s*'\s*(\d+)") { return [int]$Matches[1] + [int]$Matches[2] / 12.0 }
  return $null
}
# Apply one runners[] movement to a runnerId->base map. A runner we have not seen leaving a base
# (pinch runner) replaces whoever was sitting there and has not moved yet in this play.
function Step-Runner([hashtable]$bases, [hashtable]$touched, $rn) {
  $rid = "$($rn.details.runner.id)"
  $start = $rn.movement.start
  if ($start -and -not $bases.ContainsKey($rid)) {
    foreach ($k in @($bases.Keys)) { if ($bases[$k] -eq $start -and -not $touched.ContainsKey($k)) { $bases.Remove($k) } }
  }
  if ($rn.movement.isOut -or $rn.movement.end -notin '1B', '2B', '3B') { $bases.Remove($rid) } else { $bases[$rid] = $rn.movement.end }
  $touched[$rid] = $true
}
function Get-OnBase([hashtable]$bases) { , @('1B', '2B', '3B' | Where-Object { $bases.Values -contains $_ }) }
function CallWord([string]$code) { if ($code -eq 'C') { 'strike' } else { 'ball' } }
function Flip([string]$w) { if ($w -eq 'strike') { 'ball' } else { 'strike' } }
function Get-Family([string]$code) {
  if ($code -in 'FF', 'SI', 'FC', 'FT', 'FA') { 'fastball' }
  elseif ($code -in 'SL', 'ST', 'SV', 'CU', 'KC', 'CS') { 'breaking' }
  elseif ($code -in 'CH', 'FS', 'FO', 'SC') { 'offspeed' }
  else { 'other' }
}

# ---------------------------------------------------------------- extract
$pool = New-Object System.Collections.Generic.List[object]
$work = New-Object System.Collections.Generic.List[object]       # internal extras for validation
$gameMeta = New-Object System.Collections.Generic.List[object]
$checks = [ordered]@{ countMismatch = @(); outsMismatch = @(); runnersMismatch = 0; runnersChecked = 0; skippedNoTracking = @(); ballInDirt = 0 }
$scored = @{}                          # "gamePk|inning|half|runnerId" for every run scored (used to back "why" text)

foreach ($gm in $Games) {
  Write-Host "Fetching game $($gm.n) ($($gm.pk)) ..."
  $feed = Get-Feed $gm.pk
  $gd = $feed.gameData
  $teams = @{ "$($gd.teams.away.id)" = $gd.teams.away.abbreviation; "$($gd.teams.home.id)" = $gd.teams.home.abbreviation }
  $hp = ($feed.liveData.boxscore.officials | Where-Object { $_.officialType -eq 'Home Plate' } | Select-Object -First 1).official.fullName
  $gameMeta.Add([ordered]@{
      gamePk = $gm.pk; gameNumber = $gm.n; date = $gd.datetime.officialDate
      away = $gd.teams.away.abbreviation; home = $gd.teams.home.abbreviation
      awayName = $gd.teams.away.name; homeName = $gd.teams.home.name
      finalScore = [ordered]@{ away = $feed.liveData.linescore.teams.away.runs; home = $feed.liveData.linescore.teams.home.runs }
      venue = $gd.venue.name; plateUmpire = $hp; calledPitches = 0
    })

  $score = @{ away = 0; home = 0 }
  $prevPlay = $null
  $basesById = @{}                     # runnerId -> '1B'/'2B'/'3B' at start of current PA
  foreach ($play in $feed.liveData.plays.allPlays) {
    $ab = $play.about
    $newHalf = ($null -eq $prevPlay) -or ($prevPlay.about.inning -ne $ab.inning) -or ($prevPlay.about.halfInning -ne $ab.halfInning)
    if ($newHalf) { $outsStart = 0; $basesById = @{} } else { $outsStart = [int]$prevPlay.count.outs }
    $battingTeamId = if ($ab.isTopInning) { $gd.teams.away.id } else { $gd.teams.home.id }

    # ABS challenges recorded at play level (PA-ending challenged pitch)
    $playMJ = @()
    if ($play.reviewDetails) {
      $playMJ = @(@($play.reviewDetails) + @($play.reviewDetails.additionalReviews) | Where-Object { $_ -and $_.reviewType -eq 'MJ' })
    }
    $lastPitch = @($play.playEvents | Where-Object { $_.isPitch }) | Select-Object -Last 1
    $runners = @($play.runners)
    foreach ($rn in $runners) { if ($rn.movement.end -eq 'score') { $scored["$($gm.pk)|$($ab.inning)|$($ab.halfInning)|$($rn.details.runner.id)"] = $true } }

    $runScore = @{ away = $score.away; home = $score.home }
    $prevCount = @{ balls = 0; strikes = 0 }
    foreach ($ev in $play.playEvents) {
      if ($ev.isPitch -and $ev.details.call.code -eq '*B') { $checks.ballInDirt++ }
      if ($ev.isPitch -and $ev.details.call.code -in 'C', 'B') {
        $pd = $ev.pitchData
        $c = $pd.coordinates
        if ($null -eq $c -or $null -eq $c.vY0 -or $null -eq $c.aY -or $null -eq $pd.strikeZoneTop) {
          $checks.skippedNoTracking += "$($gm.pk)-$($play.atBatIndex)-$($ev.pitchNumber)"
        }
        else {
          # bases / outs before this pitch
          $bb = @{}; foreach ($k in $basesById.Keys) { $bb[$k] = $basesById[$k] }
          $tt = @{}
          $outsHere = $outsStart
          foreach ($rn in $runners) {
            if ([int]$rn.details.playIndex -lt [int]$ev.index) {
              if ($rn.movement.isOut) { $outsHere++ }
              Step-Runner $bb $tt $rn
            }
          }
          if ($null -ne $ev.count.outs -and [int]$ev.count.outs -ne $outsHere) { $checks.outsMismatch += "$($gm.pk)-$($play.atBatIndex)-$($ev.pitchNumber): feed=$($ev.count.outs) mine=$outsHere" }
          $onBase = Get-OnBase $bb

          # count check: post-pitch count must equal before + this (final) call
          $finalCode = $ev.details.call.code
          $expB = $prevCount.balls + [int]($finalCode -eq 'B'); $expS = $prevCount.strikes + [int]($finalCode -eq 'C')
          if ($expB -ne [int]$ev.count.balls -or $expS -ne [int]$ev.count.strikes) {
            $checks.countMismatch += "$($gm.pk)-$($play.atBatIndex)-$($ev.pitchNumber): before=$($prevCount.balls)-$($prevCount.strikes) call=$finalCode after=$($ev.count.balls)-$($ev.count.strikes)"
          }

          # kinematics
          $tF = Get-TAtY $c $Y_FRONT; $tM = Get-TAtY $c $Y_MID
          $yRel = 60.5 - [double]$pd.extension
          $tR = Get-TAtY $c $yRel
          $pF = Get-PosAt $c $tF; $pM = Get-PosAt $c $tM; $pR = Get-PosAt $c $tR
          $top = [double]$pd.strikeZoneTop; $bot = [double]$pd.strikeZoneBottom
          $margin = Get-EdgeMargin $pM.x $pM.z $top $bot
          $truth = if ($margin -ge 0) { 'strike' } else { 'ball' }

          # challenge (pitch-level, or play-level when it was the PA-ending pitch)
          $rev = $null; $revSource = $null
          if ($ev.reviewDetails) {
            $rev = @(@($ev.reviewDetails) + @($ev.reviewDetails.additionalReviews) | Where-Object { $_ -and $_.reviewType -eq 'MJ' }) | Select-Object -First 1
            if ($rev) { $revSource = 'pitch' }
          }
          if (-not $rev -and $playMJ.Count -gt 0 -and $lastPitch -and $lastPitch.index -eq $ev.index) { $rev = $playMJ[0]; $revSource = 'play' }

          $finalCall = CallWord $finalCode
          $challenge = $null
          if ($rev) {
            $umpCall = if ($rev.isOverturned) { Flip $finalCall } else { $finalCall }
            $byId = $rev.player.id
            $role = if ($byId -eq $play.matchup.batter.id) { 'batter' } elseif ($byId -eq $play.matchup.pitcher.id) { 'pitcher' } else {
              $pp = $gd.players."ID$byId".primaryPosition.abbreviation; if ($pp -eq 'C') { 'catcher' } else { "fielder($pp)" } }
            $challenge = [ordered]@{ by = $rev.player.fullName; byId = $byId; byTeam = $teams["$($rev.challengeTeamId)"]; byRole = $role; isOverturned = [bool]$rev.isOverturned }
          }
          else { $umpCall = $finalCall }

          $bid = $play.matchup.batter.id; $pitId = $play.matchup.pitcher.id
          $hFt = Get-HeightFt $gd.players."ID$bid".height
          $batAbbr = if ($ab.isTopInning) { $gd.teams.away.abbreviation } else { $gd.teams.home.abbreviation }
          $fldAbbr = if ($ab.isTopInning) { $gd.teams.home.abbreviation } else { $gd.teams.away.abbreviation }
          $rec = [ordered]@{
            id          = "$($gm.pk)-$($play.atBatIndex)-$($ev.pitchNumber)"
            gamePk      = $gm.pk
            gameNumber  = $gm.n
            inning      = $ab.inning
            half        = $ab.halfInning
            outs        = $outsHere
            countBefore = [ordered]@{ balls = $prevCount.balls; strikes = $prevCount.strikes }
            score       = [ordered]@{ away = $runScore.away; home = $runScore.home }
            runnersOn   = $onBase
            batter      = [ordered]@{ id = $bid; name = $play.matchup.batter.fullName; side = $play.matchup.batSide.code; heightFt = Rnd $hFt 4; team = $batAbbr }
            pitcher     = [ordered]@{ id = $pitId; name = $play.matchup.pitcher.fullName; hand = $play.matchup.pitchHand.code; team = $fldAbbr }
            pitchType   = [ordered]@{ code = $ev.details.type.code; name = $ev.details.type.description; family = Get-Family $ev.details.type.code }
            startSpeed  = Rnd $pd.startSpeed 1
            endSpeed    = Rnd $pd.endSpeed 1
            spinRate    = if ($null -ne $pd.breaks.spinRate) { [int]$pd.breaks.spinRate } else { $null }
            extension   = Rnd $pd.extension 4
            plateTime   = Rnd $pd.plateTime 4
            flightTime  = Rnd ($tF - $tR) 4
            traj        = [ordered]@{ x0 = Rnd $c.x0; y0 = Rnd $c.y0; z0 = Rnd $c.z0; vX0 = Rnd $c.vX0; vY0 = Rnd $c.vY0; vZ0 = Rnd $c.vZ0; aX = Rnd $c.aX; aY = Rnd $c.aY; aZ = Rnd $c.aZ }
            release     = [ordered]@{ x = Rnd $pR.x; y = Rnd $yRel; z = Rnd $pR.z; t = Rnd $tR }
            front       = [ordered]@{ x = Rnd $pF.x; z = Rnd $pF.z; t = Rnd $tF }
            mid         = [ordered]@{ x = Rnd $pM.x; z = Rnd $pM.z; t = Rnd $tM }
            feedPX      = Rnd $c.pX
            feedPZ      = Rnd $c.pZ
            zone        = [ordered]@{ top = Rnd $top 3; bottom = Rnd $bot 3 }
            absTruth    = $truth
            edgeMarginIn = Rnd $margin 2
            umpCall     = $umpCall
            finalCall   = $finalCall
            umpCorrect  = ($umpCall -eq $truth)
            challenge   = $challenge
            paResult    = $play.result.event
          }
          $pool.Add($rec)
          $work.Add([pscustomobject]@{
              rec = $rec; tF = $tF; tM = $tM; pF = $pF; pM = $pM; top = $top; bot = $bot; hFt = $hFt
              pX = [double]$c.pX; pZ = [double]$c.pZ; plateTime = [double]$pd.plateTime; revSource = $revSource
              battingTeamId = $battingTeamId; challengeTeamId = if ($rev) { $rev.challengeTeamId } else { $null }
              playDesc = $play.result.description; awayAbbr = $gd.teams.away.abbreviation; homeAbbr = $gd.teams.home.abbreviation
            })
          $gameMeta[-1].calledPitches++
        }
      }
      if ($null -ne $ev.count) { $prevCount = @{ balls = [int]$ev.count.balls; strikes = [int]$ev.count.strikes } }
      if ($null -ne $ev.details.awayScore) { $runScore = @{ away = [int]$ev.details.awayScore; home = [int]$ev.details.homeScore } }
    }

    # advance base state through the whole PA and check against the feed's post-PA runners
    $tt = @{}
    foreach ($rn in $runners) { Step-Runner $basesById $tt $rn }
    if ($play.count.outs -lt 3) {
      $mine = (Get-OnBase $basesById) -join ','
      $feedPost = (@(@{ b = '1B'; v = $play.matchup.postOnFirst }, @{ b = '2B'; v = $play.matchup.postOnSecond }, @{ b = '3B'; v = $play.matchup.postOnThird } | Where-Object { $_.v } | ForEach-Object { $_.b }) -join ',')
      $checks.runnersChecked++
      if ($mine -ne $feedPost) { $checks.runnersMismatch++; Write-Host "  runners mismatch $($gm.pk) ab=$($play.atBatIndex): mine=[$mine] feed=[$feedPost]" }
      # trust the feed for the next PA
      $basesById = @{}
      if ($play.matchup.postOnFirst) { $basesById["$($play.matchup.postOnFirst.id)"] = '1B' }
      if ($play.matchup.postOnSecond) { $basesById["$($play.matchup.postOnSecond.id)"] = '2B' }
      if ($play.matchup.postOnThird) { $basesById["$($play.matchup.postOnThird.id)"] = '3B' }
    }
    $score = @{ away = [int]$play.result.awayScore; home = [int]$play.result.homeScore }
    $prevPlay = $play
  }
}

# ---------------------------------------------------------------- validation
function Stats([double[]]$v) {
  $s = $v | Measure-Object -Average -Maximum -Minimum
  [ordered]@{ mean = Rnd $s.Average 4; min = Rnd $s.Minimum 4; max = Rnd $s.Maximum 4 }
}
$W = $work.ToArray()
$resFront = $W | ForEach-Object { 12 * [Math]::Sqrt([Math]::Pow($_.pF.x - $_.pX, 2) + [Math]::Pow($_.pF.z - $_.pZ, 2)) }
$resMid = $W | ForEach-Object { 12 * [Math]::Sqrt([Math]::Pow($_.pM.x - $_.pX, 2) + [Math]::Pow($_.pM.z - $_.pZ, 2)) }
$ptRes = $W | ForEach-Object { 1000 * ($_.plateTime - $_.tF) }                      # feed plateTime - model t(y0=50 -> front), ms
$ptResRel = $W | ForEach-Object { 1000 * ($_.plateTime - $_.rec.flightTime) }      # feed plateTime - model release -> front, ms
$zoneTopRatio = $W | ForEach-Object { $_.top / $_.hFt }
$zoneBotRatio = $W | ForEach-Object { $_.bot / $_.hFt }

# agreement of ABS truth with the umpire's original call, under variants (for the investigation table)
function Variant([string]$name, [scriptblock]$isStrike) {
  $agree = 0; $chMatch = 0; $chN = 0
  foreach ($it in $W) {
    $t = if (& $isStrike $it) { 'strike' } else { 'ball' }
    if ($t -eq $it.rec.umpCall) { $agree++ }
    if ($it.rec.challenge) { $chN++; if ($t -eq $it.rec.finalCall) { $chMatch++ } }
  }
  [ordered]@{ variant = $name; agreeWithUmp = $agree; total = $W.Count; agreePct = Rnd (100.0 * $agree / $W.Count) 1; challengeMatches = $chMatch; challenges = $chN }
}
$variants = @(
  (Variant 'mid-plate, r=1.45in, exact disc geometry (USED)' { param($q) (Get-EdgeMargin $q.pM.x $q.pM.z $q.top $q.bot) -ge 0 }),
  (Variant 'mid-plate, r=1.45in, box rule'                  { param($q) Test-BoxStrike $q.pM.x $q.pM.z $q.top $q.bot }),
  (Variant 'front of plate, r=1.45in, exact'                { param($q) (Get-EdgeMargin $q.pF.x $q.pF.z $q.top $q.bot) -ge 0 }),
  (Variant 'feed pX/pZ, r=1.45in, exact'                    { param($q) (Get-EdgeMargin $q.pX $q.pZ $q.top $q.bot) -ge 0 }),
  (Variant 'mid-plate, r=0 (ball centre only)'              { param($q) (Get-EdgeMargin $q.pM.x $q.pM.z $q.top $q.bot 0) -ge 0 }),
  (Variant 'mid-plate, r=1.45in, zone from roster height'   { param($q) (Get-EdgeMargin $q.pM.x $q.pM.z (0.535 * $q.hFt) (0.27 * $q.hFt)) -ge 0 })
)
$boxDiff = @($W | Where-Object { ((Get-EdgeMargin $_.pM.x $_.pM.z $_.top $_.bot) -ge 0) -ne (Test-BoxStrike $_.pM.x $_.pM.z $_.top $_.bot) } | ForEach-Object { $_.rec.id })

$All = $pool.ToArray()
$agreeAll = @($All | Where-Object { $_.umpCorrect }).Count
$chal = @($All | Where-Object { $_.challenge })
$chalMatch = @($chal | Where-Object { $_.absTruth -eq $_.finalCall }).Count
$perGame = foreach ($g in $gameMeta) {
  $gp = @($All | Where-Object { $_.gamePk -eq $g.gamePk })
  [ordered]@{ gameNumber = $g.gameNumber; gamePk = $g.gamePk; called = $gp.Count; calledStrikes = @($gp | Where-Object { $_.finalCall -eq 'strike' }).Count
    umpAgree = @($gp | Where-Object umpCorrect).Count; agreePct = Rnd (100.0 * @($gp | Where-Object umpCorrect).Count / [Math]::Max(1, $gp.Count)) 1
    challenges = @($gp | Where-Object { $_.challenge }).Count; overturned = @($gp | Where-Object { $_.challenge -and $_.challenge.isOverturned }).Count }
}
# role sanity: fielding-team challenges must start from a ball, batting-team challenges from a strike
$roleCheck = @($W | Where-Object { $_.rec.challenge } | ForEach-Object {
    $byBatting = ($_.challengeTeamId -eq $_.battingTeamId)
    $expectOrig = if ($byBatting) { 'strike' } else { 'ball' }
    [pscustomobject]@{ id = $_.rec.id; ok = ($_.rec.umpCall -eq $expectOrig) }
  })

$validation = [ordered]@{
  calledPitches            = $All.Count
  umpOriginalVsAbsTruth    = [ordered]@{ agree = $agreeAll; total = $All.Count; pct = Rnd (100.0 * $agreeAll / $All.Count) 1 }
  challengedPitches        = $chal.Count
  challengeTruthEqualsFinal = [ordered]@{ match = $chalMatch; total = $chal.Count }
  challengeRoleConsistent  = [ordered]@{ ok = @($roleCheck | Where-Object ok).Count; total = $roleCheck.Count }
  perGame                  = @($perGame)
  feedPXPZResidualIn       = [ordered]@{ vsFrontOfPlate = (Stats $resFront); vsMidPlate = (Stats $resMid) }
  plateTimeMinusModelMs    = [ordered]@{ vsY50ToFront = (Stats $ptRes); vsReleaseToFront = (Stats $ptResRel) }
  zoneTopOverRosterHeight  = (Stats $zoneTopRatio)
  zoneBottomOverRosterHeight = (Stats $zoneBotRatio)
  variants                 = @($variants)
  boxVsExactDifferences    = $boxDiff
  postPitchCountMismatches = @($checks.countMismatch)
  outsMismatches           = @($checks.outsMismatch).Count
  runnersCheckedPAs        = $checks.runnersChecked
  runnersMismatches        = $checks.runnersMismatch
  skippedNoTracking        = @($checks.skippedNoTracking)
}

# ---------------------------------------------------------------- extra checks
# feed plateTime is consistent with "time from a fixed y to the front of the plate": solve that y per pitch
$ptStartY = $W | ForEach-Object { (Get-PosAt $_.rec.traj ($_.tF - $_.plateTime)).y }
$validation.plateTimeImpliedStartYFt = (Stats $ptStartY)
# ABS zone should be constant per batter (it is a function of height only)
$zoneVar = @($W | Group-Object { $_.rec.batter.id } | Where-Object { @($_.Group | ForEach-Object { "$($_.top)|$($_.bot)" } | Select-Object -Unique).Count -gt 1 })
$validation.battersWithMoreThanOneZone = $zoneVar.Count
$validation.batters = @($W | ForEach-Object { $_.rec.batter.id } | Select-Object -Unique).Count
$validation.challengeRecordedAt = [ordered]@{ pitchEvent = @($W | Where-Object { $_.revSource -eq 'pitch' }).Count; playLevel = @($W | Where-Object { $_.revSource -eq 'play' }).Count }
$validation.ballInDirtExcluded = $checks.ballInDirt

# ---------------------------------------------------------------- renderer ranges
function Range($vals, [int]$d = 3) { $s = $vals | Measure-Object -Minimum -Maximum -Average; [ordered]@{ min = Rnd $s.Minimum $d; max = Rnd $s.Maximum $d; mean = Rnd $s.Average $d } }
function Get-Ranges($recs) {
  [ordered]@{
    releaseX   = Range ($recs | ForEach-Object { $_.release.x })
    releaseY   = Range ($recs | ForEach-Object { $_.release.y })
    releaseZ   = Range ($recs | ForEach-Object { $_.release.z })
    flightTime = Range ($recs | ForEach-Object { $_.flightTime })
    startSpeed = Range ($recs | ForEach-Object { $_.startSpeed }) 1
    endSpeed   = Range ($recs | ForEach-Object { $_.endSpeed }) 1
    midX       = Range ($recs | ForEach-Object { $_.mid.x })
    midZ       = Range ($recs | ForEach-Object { $_.mid.z })
    zoneTop    = Range ($recs | ForEach-Object { $_.zone.top })
    zoneBottom = Range ($recs | ForEach-Object { $_.zone.bottom })
  }
}
$ranges = Get-Ranges $All
$rangesByFamily = [ordered]@{}
foreach ($fam in 'fastball', 'breaking', 'offspeed') {
  $fr = @($All | Where-Object { $_.pitchType.family -eq $fam })
  if ($fr.Count) { $rangesByFamily[$fam] = [ordered]@{ n = $fr.Count; flightTime = Range ($fr | ForEach-Object { $_.flightTime }); startSpeed = Range ($fr | ForEach-Object { $_.startSpeed }) 1 } }
}

# ---------------------------------------------------------------- Today's Ten (curated, Game 5)
# Hand-picked against the selection rules; every claim in the "why" text is either computed from the record
# or asserted below, and the rule checklist is re-verified on every run.
function Get-Side($p) {
  $inside = ($p.batter.side -eq 'R' -and $p.mid.x -lt 0) -or ($p.batter.side -eq 'L' -and $p.mid.x -gt 0)
  if ($inside) { 'inside' } else { 'away' }
}
# Where the ball is relative to the zone, from the umpire's point of view of the batter.
function Get-Where($p) {
  $dx = [Math]::Abs(12 * $p.mid.x) - $HALF_W_IN
  $dLo = 12 * $p.zone.bottom - 12 * $p.mid.z
  $dHi = 12 * $p.mid.z - 12 * $p.zone.top
  $side = Get-Side $p
  $vert = if ($dLo -gt $dHi) { 'low' } else { 'high' }
  $dz = [Math]::Max($dLo, $dHi)
  if ($p.absTruth -eq 'ball') {
    if ($dx -gt 0 -and $dz -gt 0) { return "$vert and $side" }
    if ($dx -ge $dz) { return $side } else { return $vert }
  }
  if ($dx -ge $dz) { return "the $side edge" }
  if ($vert -eq 'low') { return 'the bottom of the zone' } else { return 'the top of the zone' }
}
function Get-Loc($p) { $w = Get-Where $p; if ($p.absTruth -eq 'ball') { "missed $w by $('{0:N1}' -f [Math]::Abs($p.edgeMarginIn)) in" } else { "caught $w by $('{0:N1}' -f $p.edgeMarginIn) in" } }
function Get-Half($p) { if ((Get-Side $p) -eq 'inside') { 'inner half' } else { 'outer half' } }
function PitchName($p) { $p.pitchType.name.ToLower() }
function Mph($p) { '{0:N1} mph' -f $p.startSpeed }
function Ord([int]$n) { switch ($n) { 1 { 'one' } 2 { 'two' } 3 { 'three' } 4 { 'four' } } }
function CountWord($p, [string]$call) {
  if ($call -eq 'strike') { $n = $p.countBefore.strikes + 1; if ($n -eq 3) { 'strike three' } else { "strike $(Ord $n)" } }
  else { $n = $p.countBefore.balls + 1; if ($n -eq 4) { 'ball four' } else { "ball $(Ord $n)" } }
}
function Last([string]$name) { $w = @($name -split ' ' | Where-Object { $_ -notin 'Jr.', 'Sr.', 'II', 'III', 'IV' }); $w[-1] }
function Challenger($p) { "$(Last $p.challenge.by) ($($p.challenge.byTeam) $($p.challenge.byRole))" }
function Verdict($p) { if ($p.challenge.isOverturned) { "overturned, so $(CountWord $p $p.umpCall) became $(CountWord $p $p.finalCall)" } else { "the call stood: $(CountWord $p $p.finalCall)" } }

$EM = [char]0x2014   # em dash
$Nick = @{}; foreach ($g in $gameMeta) { $Nick[$g.away] = ($g.awayName -split ' ')[-1]; $Nick[$g.home] = ($g.homeName -split ' ')[-1] }
$g5 = $gameMeta | Where-Object { $_.gameNumber -eq 5 }
$g5Winner = if ($g5.finalScore.away -gt $g5.finalScore.home) { $g5.away } else { $g5.home }
$Picks = @(
  @{ id = '849799-1-1'; role = 'calibrator'
    check = { param($p) $p.absTruth -eq 'strike' -and [Math]::Abs(12 * $p.mid.x) -le 3 -and [Math]::Abs(12 * ($p.mid.z - ($p.zone.top + $p.zone.bottom) / 2)) -le 3 }
    why = { param($p) "Calibrator: clear strike $EM $(Mph $p) $(PitchName $p) right down the middle." } }
  @{ id = '849799-13-1'; role = 'calibrator'
    check = { param($p) $p.absTruth -eq 'ball' }
    why = { param($p) "Calibrator: clear ball $EM $(Mph $p) $(PitchName $p) $(Get-Loc $p)." } }
  @{ id = '849799-13-2'; role = 'miss'; prev = $true
    check = { param($p) $p.startSpeed -eq $byId['849799-13-1'].startSpeed }
    why = { param($p) "Ump missed it; nobody challenged $EM the very next pitch, also $(Mph $p), $(Get-Loc $p) but was called $(CountWord $p $p.umpCall)." } }
  @{ id = '849799-31-1'; role = 'miss'; scored = $true
    check = { param($p) $p.paResult -eq 'Single' }
    why = { param($p) "Ump missed it; nobody challenged $EM $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p) but was called $(CountWord $p $p.umpCall). $(Last $p.batter.name) singled later in the at-bat and came around to score." } }
  @{ id = '849799-35-2'; role = 'edge'
    check = { param($p) $p.batter.side -eq 'L' -and $p.pitcher.hand -eq 'L' -and $p.outs -eq 2 -and @($p.runnersOn).Count -eq 2 }
    why = { param($p) "Lefty vs. lefty with two on and two out $EM $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p). Ump got it right." } }
  @{ id = '849799-36-2'; role = 'challenge'
    why = { param($p) "$(Challenger $p) challenged this $EM $(Verdict $p). $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p)." } }
  @{ id = '849799-51-1'; role = 'challenge'
    why = { param($p) "$(Challenger $p) challenged this $EM $(Verdict $p). $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p)." } }
  @{ id = '849799-57-1'; role = 'edge'
    check = { param($p) $p.pitchType.family -eq 'offspeed' -and (Get-Where $p) -eq 'the bottom of the zone' }
    why = { param($p) "Offspeed at the knees $EM $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p). Ump got it right." } }
  @{ id = '849799-65-5'; role = 'edge'
    check = { param($p) $p.half -eq 'bottom' -and $p.inning -eq 9 -and $p.countBefore.strikes -eq 2 }
    why = { param($p) "Bottom 9, $($p.countBefore.balls)-$($p.countBefore.strikes) to $(Last $p.batter.name) $EM $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) $(Get-Loc $p). A strike call would have ended the at-bat; the ump got it right: $(CountWord $p $p.umpCall)." } }
  @{ id = '849799-65-7'; role = 'finale'
    check = { param($p) $p.half -eq 'bottom' -and $p.inning -eq 9 -and $p.outs -eq 0 -and $p.countBefore.strikes -eq 2 -and $p.finalCall -eq 'strike' -and $p.paResult -eq 'Strikeout' -and $p.pitcher.team -eq $g5Winner }
    why = { param($p) "Finale: bottom 9, $($p.countBefore.balls)-$($p.countBefore.strikes) to $(Last $p.batter.name) $EM $(Last $p.pitcher.name)'s $(Mph $p) $(PitchName $p) on the $(Get-Half $p), called strike three. The $($Nick[$p.pitcher.team]) are two outs from the title." } }
)

$byId = @{}; foreach ($r in $All) { $byId[$r.id] = $r }
$problems = New-Object System.Collections.Generic.List[string]
$ten = New-Object System.Collections.Generic.List[object]
$order = 0
foreach ($pick in $Picks) {
  $q = $byId[$pick.id]
  if (-not $q) { $problems.Add("pick $($pick.id) not found"); continue }
  $order++
  $o = [ordered]@{ order = $order; role = $pick.role; why = (& $pick.why $q) }
  foreach ($k in $q.Keys) { $o[$k] = $q[$k] }
  # per-role assertions backing the "why" text
  switch ($pick.role) {
    'calibrator' { if (-not $q.umpCorrect -or [Math]::Abs($q.edgeMarginIn) -lt 6) { $problems.Add("$($q.id): calibrator not obvious") } }
    'miss' { if ($q.umpCorrect -or $q.challenge) { $problems.Add("$($q.id): not an unchallenged miss") } }
    'challenge' { if (-not $q.challenge) { $problems.Add("$($q.id): not a challenged pitch") } }
    'edge' { if (-not $q.umpCorrect -or [Math]::Abs($q.edgeMarginIn) -gt 2.5) { $problems.Add("$($q.id): not a correctly-called edge pitch") } }
    'finale' { if ($order -ne $Picks.Count) { $problems.Add("$($q.id): finale is not last") } }
  }
  if ($pick.check -and -not (& $pick.check $q)) { $problems.Add("$($q.id): why-text assertion failed") }
  if ($pick.scored -and -not $scored.ContainsKey("$($q.gamePk)|$($q.inning)|$($q.half)|$($q.batter.id)")) { $problems.Add("$($q.id): batter did not score") }
  if ($pick.prev) {
    # "the very next pitch" claims: previous pick must be the preceding pitch of the same PA
    $prevId = $Picks[$order - 2].id; $a = $prevId.Split('-'); $b = $q.id.Split('-')
    if ($a[0] -ne $b[0] -or $a[1] -ne $b[1] -or [int]$a[2] + 1 -ne [int]$b[2]) { $problems.Add("$($q.id): not the very next pitch") }
  }
  $ten.Add($o)
}
$T = $ten.ToArray()

# rule checklist
$sortKey = { param($p) '{0}-{1:D4}-{2:D3}' -f $p.gameNumber, [int]($p.id.Split('-')[1]), [int]($p.id.Split('-')[2]) }
$isOrdered = ((@($T | ForEach-Object { & $sortKey $_ }) -join ',') -eq (@($T | ForEach-Object { & $sortKey $_ } | Sort-Object) -join ','))
$g5Chal = @($All | Where-Object { $_.gameNumber -eq 5 -and $_.challenge } | ForEach-Object { $_.id })
$g5Decisive = @($All | Where-Object { $_.gameNumber -eq 5 -and $_.inning -ge 8 -and (($_.finalCall -eq 'strike' -and $_.countBefore.strikes -eq 2) -or ($_.finalCall -eq 'ball' -and $_.countBefore.balls -eq 3)) }) | Select-Object -Last 1
$ruleFinale = if ($g5Decisive) { $g5Decisive.id } else { (@($All | Where-Object { $_.gameNumber -eq 5 }) | Select-Object -Last 1).id }
$nonCal = @($T | Where-Object { $_.role -ne 'calibrator' })
$selectionChecks = [ordered]@{
  orderedAsPlayed            = $isOrdered
  startsWithTwoCalibrators   = ($T[0].role -eq 'calibrator' -and $T[1].role -eq 'calibrator' -and (@($T[0].absTruth, $T[1].absTruth) | Sort-Object -Unique).Count -eq 2)
  allGame5ChallengesIncluded = (@($g5Chal | Where-Object { $_ -notin $T.id }).Count -eq 0)
  unchallengedMisses         = @($T | Where-Object { -not $_.umpCorrect -and -not $_.challenge }).Count
  borderlineLe1p5            = @($nonCal | Where-Object { [Math]::Abs($_.edgeMarginIn) -le 1.5 }).Count
  borderlineLe2p5            = @($nonCal | Where-Object { [Math]::Abs($_.edgeMarginIn) -le 2.5 }).Count
  nonCalibrators             = $nonCal.Count
  families                   = @($T | ForEach-Object { $_.pitchType.family } | Sort-Object -Unique)
  batterSides                = @($T | ForEach-Object { $_.batter.side } | Sort-Object -Unique)
  pitchers                   = @($T | ForEach-Object { $_.pitcher.name } | Select-Object -Unique).Count
  finaleMatchesRule          = ($T[-1].id -eq $ruleFinale)
  allFromGame5               = (@($T | Where-Object { $_.gameNumber -ne 5 }).Count -eq 0)
}
if (-not $selectionChecks.orderedAsPlayed) { $problems.Add('ten not in played order') }
if (-not $selectionChecks.startsWithTwoCalibrators) { $problems.Add('ten does not start with a strike + ball calibrator') }
if (-not $selectionChecks.allGame5ChallengesIncluded) { $problems.Add('a Game 5 challenge is missing') }
if ($selectionChecks.unchallengedMisses -lt 1) { $problems.Add('no unchallenged miss') }
if ($selectionChecks.families.Count -lt 3) { $problems.Add('pitch families missing') }
if ($selectionChecks.batterSides.Count -lt 2) { $problems.Add('only one batter side') }
if (-not $selectionChecks.finaleMatchesRule) { $problems.Add("finale differs from rule pick $ruleFinale") }

$seriesWins = @{}
foreach ($g in $gameMeta) { $winAbbr = if ($g.finalScore.away -gt $g.finalScore.home) { $g.away } else { $g.home }; $seriesWins[$winAbbr] = 1 + [int]$seriesWins[$winAbbr] }
$winner = if ($g5.finalScore.away -gt $g5.finalScore.home) { @{ abbr = $g5.away; name = $g5.awayName; r = $g5.finalScore.away } } else { @{ abbr = $g5.home; name = $g5.homeName; r = $g5.finalScore.home } }
$loser = if ($g5.finalScore.away -gt $g5.finalScore.home) { @{ abbr = $g5.home; name = $g5.homeName; r = $g5.finalScore.home } } else { @{ abbr = $g5.away; name = $g5.awayName; r = $g5.finalScore.away } }
$dot = [char]0x00B7
$nick = { param($full) ($full -split ' ')[-1] }
$dateTxt = ([datetime]::ParseExact($g5.date, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture)).ToString('MMMM d, yyyy', [cultureinfo]::InvariantCulture)
$tenDoc = [ordered]@{
  title    = "2026 World Series $dot Game 5"
  subtitle = "$(& $nick $winner.name) $($winner.r), $(& $nick $loser.name) $($loser.r) $dot $($winner.name.Split(' ')[0]) wins the Series $($seriesWins[$winner.abbr])-$($seriesWins[$loser.abbr]) $dot $($g5.venue) $dot $dateTxt $dot Plate umpire: $($g5.plateUmpire)"
  source   = $SOURCE
  game     = [ordered]@{ gamePk = $g5.gamePk; gameNumber = 5; date = $g5.date; away = $g5.away; home = $g5.home; finalScore = $g5.finalScore; venue = $g5.venue; plateUmpire = $g5.plateUmpire }
  summary  = [ordered]@{
    pitches           = $T.Count
    trueStrikes       = @($T | Where-Object { $_.absTruth -eq 'strike' }).Count
    trueBalls         = @($T | Where-Object { $_.absTruth -eq 'ball' }).Count
    umpRight          = @($T | Where-Object { $_.umpCorrect }).Count
    umpWrong          = @($T | Where-Object { -not $_.umpCorrect }).Count
    challenged        = @($T | Where-Object { $_.challenge }).Count
    overturned        = @($T | Where-Object { $_.challenge -and $_.challenge.isOverturned }).Count
    rightAfterReviews = @($T | Where-Object { $_.finalCall -eq $_.absTruth }).Count
    borderline        = $selectionChecks.borderlineLe1p5
    closeCalls        = @($nonCal | Where-Object { [Math]::Abs($_.edgeMarginIn) -le 2.0 }).Count
    borderlineNote    = 'borderline = |edgeMarginIn| <= 1.5 in, closeCalls = <= 2.0 in (calibrators excluded)'
    game5UmpAccuracy  = "$(@($All | Where-Object { $_.gameNumber -eq 5 -and $_.umpCorrect }).Count)/$(@($All | Where-Object { $_.gameNumber -eq 5 }).Count) called pitches"
  }
  pitches  = $T
}

# ---------------------------------------------------------------- write
$utf8 = [System.Text.UTF8Encoding]::new($false)
$poolDoc = [ordered]@{
  title       = "Umpire's Eye $EM called-pitch pool, 2026 World Series (G1-G5)"
  source      = $SOURCE
  generatedBy = 'fetch.ps1'
  conventions = [ordered]@{
    units       = 'feet, seconds, mph; edgeMarginIn and heightFt as named'
    axes        = 'catcher view: x horizontal (0 = plate centre, + = catcher''s right / 1B side), y toward pitcher (0 = back tip of plate, front edge = 17/12), z up from ground'
    trajectory  = 'p(t) = p0 + v0 t + a t^2 / 2 with t = 0 at y0 (50 ft); release.t < 0'
    planes      = 'front: y = 17/12 ft; mid: y = 8.5/12 ft (ABS plane); release: y = 60.5 - extension'
    absRule     = 'strike if any part of the ball (r = 1.45 in) touches the 17 in x [bottom, top] rectangle at mid-plate (exact disc geometry)'
    calls       = 'umpCall = umpire''s original call; finalCall = call after any ABS challenge (feed details.call)'
  }
  games       = $gameMeta.ToArray()
  validation  = $validation
  ranges      = $ranges
  rangesByFamily = $rangesByFamily
  count       = $All.Count
  pitches     = '__PITCHES__'
}
$head = ($poolDoc | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
$lines = ($All | ForEach-Object { '    ' + ($_ | ConvertTo-Json -Depth 20 -Compress) }) -join ",`n"
$poolText = $head.Replace('"__PITCHES__"', "[`n$lines`n  ]") + "`n"
[System.IO.File]::WriteAllText((Join-Path $OutDir 'pool.json'), $poolText, $utf8)
$tenText = (($tenDoc | ConvertTo-Json -Depth 20) -replace "`r`n", "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path $OutDir 'ten.json'), $tenText, $utf8)

# ---------------------------------------------------------------- report
$v = $validation
Write-Host ''
Write-Host "Called pitches: $($v.calledPitches)  (per game: $((@($v.perGame) | ForEach-Object { "G$($_.gameNumber)=$($_.called)" }) -join ', '))"
Write-Host "(a) ABS truth vs umpire ORIGINAL call: $($v.umpOriginalVsAbsTruth.agree)/$($v.umpOriginalVsAbsTruth.total) = $($v.umpOriginalVsAbsTruth.pct)%"
Write-Host "(b) ABS-challenged pitches where truth == final call: $($v.challengeTruthEqualsFinal.match)/$($v.challengeTruthEqualsFinal.total)  (role-consistent: $($v.challengeRoleConsistent.ok)/$($v.challengeRoleConsistent.total))"
Write-Host "feed pX/pZ residual (in): front mean $($v.feedPXPZResidualIn.vsFrontOfPlate.mean) max $($v.feedPXPZResidualIn.vsFrontOfPlate.max) | mid mean $($v.feedPXPZResidualIn.vsMidPlate.mean) max $($v.feedPXPZResidualIn.vsMidPlate.max)"
foreach ($x in $v.variants) { Write-Host ("  {0,-50} agree {1}/{2} ({3}%)  challenges {4}/{5}" -f $x.variant, $x.agreeWithUmp, $x.total, $x.agreePct, $x.challengeMatches, $x.challenges) }
Write-Host "checks: countMismatches=$(@($v.postPitchCountMismatches).Count) outsMismatches=$($v.outsMismatches) runnersMismatches=$($v.runnersMismatches)/$($v.runnersCheckedPAs) boxVsExact=$(@($v.boxVsExactDifferences) -join ',') skipped=$(@($v.skippedNoTracking).Count)"
Write-Host ''
Write-Host "Today's Ten: $($tenDoc.summary.trueStrikes) true strikes / $($tenDoc.summary.trueBalls) true balls, ump right $($tenDoc.summary.umpRight)/10, after reviews $($tenDoc.summary.rightAfterReviews)/10"
foreach ($row in $T) { Write-Host ("  {0,2}. {1,-14} {2}{3} {4}-{5} {6,-18} {7,-3} {8,5} m={9,6} truth={10,-6} ump={11,-6} | {12}" -f $row.order, $row.id, $row.half.Substring(0, 1).ToUpper(), $row.inning, $row.countBefore.balls, $row.countBefore.strikes, $row.batter.name, $row.pitchType.code, $row.startSpeed, $row.edgeMarginIn, $row.absTruth, $row.umpCall, $row.why) }
Write-Host "selection checks: $(($selectionChecks.GetEnumerator() | ForEach-Object { "$($_.Key)=$(@($_.Value) -join '/')" }) -join '; ')"
if ($problems.Count) { Write-Warning ("PROBLEMS:`n  " + ($problems -join "`n  ")) } else { Write-Host 'No problems.' }
Write-Host "Wrote $(Join-Path $OutDir 'pool.json') and $(Join-Path $OutDir 'ten.json')"
