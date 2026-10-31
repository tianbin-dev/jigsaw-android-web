(function () {
  'use strict';

  var LEVELS = {
    3: { name: '低级', asset: 'assets/number_level_3.png' },
    4: { name: '中级', asset: 'assets/number_level_4.png' },
    5: { name: '高级', asset: 'assets/number_level_5.png' }
  };

  var startView = document.getElementById('startView');
  var gameView = document.getElementById('gameView');
  var board = document.getElementById('board');
  var timerEl = document.getElementById('timer');
  var levelLabel = document.getElementById('levelLabel');
  var previewImg = document.getElementById('previewImg');
  var changeLevelBtn = document.getElementById('changeLevelBtn');
  var startBtn = document.getElementById('startBtn');
  var pauseBtn = document.getElementById('pauseBtn');
  var levelModal = document.getElementById('levelModal');
  var levelRows = Array.prototype.slice.call(document.querySelectorAll('.level-row'));
  var pauseModal = document.getElementById('pauseModal');
  var successModal = document.getElementById('successModal');
  var resumeBtn = document.getElementById('resumeBtn');
  var exitBtn = document.getElementById('exitBtn');
  var closeSuccessBtn = document.getElementById('closeSuccessBtn');
  var playAgainBtn = document.getElementById('playAgainBtn');
  var hintBtn = document.getElementById('hintBtn');
  var recordsBtn = document.getElementById('recordsBtn');
  var recordsModal = document.getElementById('recordsModal');
  var closeRecordsBtn = document.getElementById('closeRecordsBtn');
  var clearRecordsBtn = document.getElementById('clearRecordsBtn');
  var bestGrid = document.getElementById('bestGrid');
  var recordsList = document.getElementById('recordsList');
  var recordsEmpty = document.getElementById('recordsEmpty');

  var state = {
    selectedLevel: 3,
    level: 3,
    blankValue: 8,
    values: [],
    blankIndex: 8,
    tiles: {},
    elapsed: 0,
    timerId: null,
    playing: false,
    paused: false,
    finished: false,
    drag: null,
    lastFocus: null,
    moves: 0,
    recorded: false,
    hintBusy: false,
    hintValue: -1,
    hintTimer: null
  };

  function formatTime(totalSeconds) {
    var seconds = totalSeconds % 60;
    var minutes = Math.floor(totalSeconds / 60) % 60;
    var hours = Math.floor(totalSeconds / 3600);
    return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isSolved(values) {
    for (var i = 0; i < values.length; i++) {
      if (values[i] !== i) return false;
    }
    return true;
  }

  function neighborsOf(index, level) {
    var row = Math.floor(index / level);
    var col = index % level;
    var result = [];
    if (col > 0) result.push(index - 1);
    if (col < level - 1) result.push(index + 1);
    if (row > 0) result.push(index - level);
    if (row < level - 1) result.push(index + level);
    return result;
  }

  /* ---------- 求解器：为「提示」计算下一步 ---------- */

  var SOLVE_BUDGET_MS = 850;
  var SEARCH_STATE_LIMIT = 200000;

  function goalValues(level) {
    var count = level * level;
    var goal = [];
    for (var i = 0; i < count; i++) goal.push(i);
    return goal;
  }

  /** 曼哈顿距离 + 线性冲突，数值越小越接近完成态 */
  function evaluation(values, level) {
    var last = level * level - 1;
    var distance = 0;
    var rows = [];
    var cols = [];
    var r, c, i;
    for (r = 0; r < level; r++) {
      rows.push([]);
      cols.push([]);
    }
    for (i = 0; i < values.length; i++) {
      var value = values[i];
      if (value === last) continue;
      var goalRow = Math.floor(value / level);
      var goalCol = value % level;
      var cellRow = Math.floor(i / level);
      var cellCol = i % level;
      distance += Math.abs(goalRow - cellRow) + Math.abs(goalCol - cellCol);
      if (goalRow === cellRow) rows[cellRow].push(cellCol, goalCol);
      if (goalCol === cellCol) cols[cellCol].push(cellRow, goalRow);
    }
    var conflicts = 0;
    for (c = 0; c < level; c++) {
      var rowPair = rows[c];
      for (i = 0; i < rowPair.length; i += 2) {
        for (var j = i + 2; j < rowPair.length; j += 2) {
          if ((rowPair[i] - rowPair[j]) * (rowPair[i + 1] - rowPair[j + 1]) < 0) conflicts += 2;
        }
      }
      var colPair = cols[c];
      for (i = 0; i < colPair.length; i += 2) {
        for (var k = i + 2; k < colPair.length; k += 2) {
          if ((colPair[i] - colPair[k]) * (colPair[i + 1] - colPair[k + 1]) < 0) conflicts += 2;
        }
      }
    }
    return distance + conflicts;
  }

  function stateKey(values) {
    return values.join('|');
  }

  /**
   * 3×3 用双向 BFS，得到真正的最短解首步。
   * 只记录起点侧父链，命中时回溯得到第一步要移动的格子。
   */
  function solveSmall(startValues, level) {
    var last = level * level - 1;
    var goal = goalValues(level);
    var startKey = stateKey(startValues);
    var goalKey = stateKey(goal);
    if (startKey === goalKey) return -1;

    var startVisited = new Map();
    var goalVisited = new Set([goalKey]);
    var root = {
      values: startValues.slice(),
      blank: startValues.indexOf(last),
      parent: null,
      move: -1,
      key: startKey
    };
    startVisited.set(startKey, root);
    var startFrontier = [root];
    var goalFrontier = [{ values: goal.slice(), blank: last }];
    var guard = 0;

    function firstMoveOf(node) {
      var current = node;
      while (current.parent && current.parent.parent) current = current.parent;
      return current.move;
    }

    function expandStart() {
      var next = [];
      for (var i = 0; i < startFrontier.length; i++) {
        var node = startFrontier[i];
        var around = neighborsOf(node.blank, level);
        for (var k = 0; k < around.length; k++) {
          var cell = around[k];
          var values = node.values.slice();
          values[node.blank] = values[cell];
          values[cell] = last;
          var key = stateKey(values);
          if (startVisited.has(key)) continue;
          var child = { values: values, blank: cell, parent: node, move: cell, key: key };
          startVisited.set(key, child);
          if (goalVisited.has(key)) return firstMoveOf(child);
          next.push(child);
        }
      }
      startFrontier = next;
      return null;
    }

    function expandGoal() {
      var next = [];
      for (var i = 0; i < goalFrontier.length; i++) {
        var node = goalFrontier[i];
        var around = neighborsOf(node.blank, level);
        for (var k = 0; k < around.length; k++) {
          var cell = around[k];
          var values = node.values.slice();
          values[node.blank] = values[cell];
          values[cell] = last;
          var key = stateKey(values);
          if (goalVisited.has(key)) continue;
          goalVisited.add(key);
          var hit = startVisited.get(key);
          if (hit) return firstMoveOf(hit);
          next.push({ values: values, blank: cell });
        }
      }
      goalFrontier = next;
      return null;
    }

    while (startFrontier.length && goalFrontier.length && guard < SEARCH_STATE_LIMIT) {
      guard += startFrontier.length + goalFrontier.length;
      if (startFrontier.length <= goalFrontier.length) {
        var moveA = expandStart();
        if (moveA !== null) return moveA;
      } else {
        var moveB = expandGoal();
        if (moveB !== null) return moveB;
      }
    }
    return -1;
  }

  /**
   * 4×4 / 5×5 用 A*（曼哈顿 + 线性冲突），分片执行避免卡住界面；
   * 超时或超节点上限则退化为「让启发值下降最多」的一步。
   */
  function createAStarTask(startValues, level, nodeLimit) {
    var last = level * level - 1;
    var goalKey = stateKey(goalValues(level));
    var open = [];
    var bestG = new Map();
    var closed = new Set();
    var solvedNode = null;
    var guard = 0;

    function compare(a, b) {
      return (a.f - b.f) || (a.h - b.h);
    }

    function push(node) {
      open.push(node);
      var i = open.length - 1;
      while (i > 0) {
        var parent = (i - 1) >> 1;
        if (compare(open[parent], open[i]) <= 0) break;
        var tmp = open[parent];
        open[parent] = open[i];
        open[i] = tmp;
        i = parent;
      }
    }

    function pop() {
      var top = open[0];
      var end = open.pop();
      if (open.length) {
        open[0] = end;
        var i = 0;
        while (true) {
          var left = 2 * i + 1;
          var right = left + 1;
          var smallest = i;
          if (left < open.length && compare(open[left], open[smallest]) < 0) smallest = left;
          if (right < open.length && compare(open[right], open[smallest]) < 0) smallest = right;
          if (smallest === i) break;
          var tmp = open[i];
          open[i] = open[smallest];
          open[smallest] = tmp;
          i = smallest;
        }
      }
      return top;
    }

    var startKey = stateKey(startValues);
    var startH = evaluation(startValues, level);
    bestG.set(startKey, 0);
    push({ values: startValues.slice(), blank: startValues.indexOf(last), g: 0, h: startH, f: startH, key: startKey, firstMove: -1 });

    function step(budget) {
      var processed = 0;
      while (open.length && processed < budget && guard < nodeLimit) {
        var node = pop();
        if (node.key === goalKey) {
          solvedNode = node;
          return 'solved';
        }
        if (closed.has(node.key)) continue;
        closed.add(node.key);
        guard += 1;
        processed += 1;
        var nextG = node.g + 1;
        var around = neighborsOf(node.blank, level);
        for (var k = 0; k < around.length; k++) {
          var cell = around[k];
          var values = node.values.slice();
          values[node.blank] = values[cell];
          values[cell] = last;
          var key = stateKey(values);
          var known = bestG.get(key);
          if (known !== undefined && known <= nextG) continue;
          bestG.set(key, nextG);
          var h = evaluation(values, level);
          push({
            values: values,
            blank: cell,
            g: nextG,
            h: h,
            f: nextG + h,
            key: key,
            firstMove: node.firstMove === -1 ? cell : node.firstMove
          });
        }
        if (guard >= nodeLimit) return 'limit';
      }
      if (!open.length) return 'exhausted';
      return guard >= nodeLimit ? 'limit' : 'running';
    }

    return {
      step: step,
      firstMove: function () {
        return solvedNode ? solvedNode.firstMove : -1;
      },
      visited: function () {
        return bestG.size;
      }
    };
  }

  /** 启发式最优的一步：让评估值下降最多（打平时选第一个） */
  function greedyMove(values, level) {
    var last = level * level - 1;
    var blank = values.indexOf(last);
    var around = neighborsOf(blank, level);
    var best = around[0];
    var bestScore = Infinity;
    for (var i = 0; i < around.length; i++) {
      var cell = around[i];
      var trial = values.slice();
      trial[blank] = trial[cell];
      trial[cell] = last;
      var score = evaluation(trial, level);
      if (score < bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    return best;
  }

  function computeHint(values, level) {
    return new Promise(function (resolve) {
      if (level === 3) {
        var move = solveSmall(values, level);
        if (move < 0 && !isSolved(values)) move = greedyMove(values, level);
        resolve(move);
        return;
      }
      var nodeLimit = level === 4 ? 60000 : 30000;
      var task = createAStarTask(values, level, nodeLimit);
      var deadline = (window.performance && window.performance.now) ? window.performance.now() + SOLVE_BUDGET_MS : Infinity;

      function tick() {
        var status = task.step(1200);
        var now = (window.performance && window.performance.now) ? window.performance.now() : 0;
        if (status === 'solved') {
          resolve(task.firstMove());
          return;
        }
        if (status === 'limit' || status === 'exhausted' || now > deadline) {
          resolve(greedyMove(values, level));
          return;
        }
        window.setTimeout(tick, 0);
      }
      tick();
    });
  }

  /* ---------- 提示高亮 ---------- */

  function clearHint() {
    if (state.hintTimer !== null) {
      window.clearTimeout(state.hintTimer);
      state.hintTimer = null;
    }
    if (state.hintValue >= 0 && state.tiles[state.hintValue]) {
      state.tiles[state.hintValue].classList.remove('tile--hint');
    }
    state.hintValue = -1;
  }

  function showHint(cell) {
    clearHint();
    var value = state.values[cell];
    var tile = state.tiles[value];
    if (!tile) return;
    state.hintValue = value;
    tile.classList.add('tile--hint');
    state.hintTimer = window.setTimeout(clearHint, 2600);
  }

  function requestHint() {
    if (!state.playing || state.paused || state.finished || state.hintBusy) return;
    clearHint();
    state.hintBusy = true;
    hintBtn.disabled = true;
    hintBtn.textContent = '计算中';

    var snapshot = state.values.slice();
    var level = state.level;

    computeHint(snapshot, level).then(function (cell) {
      state.hintBusy = false;
      hintBtn.disabled = false;
      hintBtn.textContent = '提示';
      if (!state.playing || state.finished || state.paused) return;
      if (state.level !== level) return;
      if (stateKey(state.values) !== stateKey(snapshot)) return;
      if (cell === null || cell === undefined || cell < 0 || cell >= snapshot.length) return;
      showHint(cell);
    });
  }

  /* ---------- 游戏记录（localStorage） ---------- */

  var RECORDS_KEY = 'numpush.records.v1';
  var MAX_RECORDS = 200;

  function loadRecords() {
    var raw;
    try {
      raw = window.localStorage.getItem(RECORDS_KEY);
    } catch (error) {
      return [];
    }
    if (!raw) return [];
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(function (item) {
      return item &&
        item.level >= 3 && item.level <= 5 &&
        typeof item.seconds === 'number' &&
        typeof item.moves === 'number' &&
        typeof item.ts === 'number';
    });
  }

  function storeRecords(list) {
    try {
      window.localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
    } catch (error) {
      /* 隐私模式或配额受限时忽略 */
    }
  }

  function formatDate(ts) {
    var date = new Date(ts);
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function addRecord(level, seconds, moves) {
    var list = loadRecords();
    list.push({ level: level, seconds: seconds, moves: moves, ts: Date.now() });
    list.sort(function (a, b) { return b.ts - a.ts; });
    storeRecords(list.slice(0, MAX_RECORDS));
    renderRecords();
  }

  function renderRecords() {
    var list = loadRecords();
    var bests = {};
    [3, 4, 5].forEach(function (lv) {
      bests[lv] = { time: null, moves: null };
    });
    list.forEach(function (record) {
      var best = bests[record.level];
      if (!best) return;
      if (best.time === null || record.seconds < best.time) best.time = record.seconds;
      if (best.moves === null || record.moves < best.moves) best.moves = record.moves;
    });

    bestGrid.innerHTML = '';
    [3, 4, 5].forEach(function (lv) {
      var best = bests[lv];
      var card = document.createElement('div');
      card.className = 'best-card';
      var levelText = document.createElement('span');
      levelText.className = 'best-level';
      levelText.textContent = lv + ' × ' + lv;
      card.appendChild(levelText);

      var timeLine = document.createElement('span');
      timeLine.className = 'best-line';
      timeLine.appendChild(document.createTextNode('最佳用时 '));
      var timeValue = document.createElement('strong');
      timeValue.textContent = best.time === null ? '—' : formatTime(best.time);
      timeLine.appendChild(timeValue);
      card.appendChild(timeLine);

      var moveLine = document.createElement('span');
      moveLine.className = 'best-line';
      moveLine.appendChild(document.createTextNode('最少步数 '));
      var moveValue = document.createElement('strong');
      moveValue.textContent = best.moves === null ? '—' : best.moves + ' 步';
      moveLine.appendChild(moveValue);
      card.appendChild(moveLine);

      bestGrid.appendChild(card);
    });

    recordsList.innerHTML = '';
    if (!list.length) {
      recordsEmpty.hidden = false;
      clearRecordsBtn.disabled = true;
      return;
    }
    recordsEmpty.hidden = true;
    clearRecordsBtn.disabled = false;

    list.forEach(function (record) {
      var row = document.createElement('li');
      row.className = 'record-row';

      var levelTag = document.createElement('span');
      levelTag.className = 'record-level';
      levelTag.textContent = record.level + '×' + record.level;

      var timeCell = document.createElement('span');
      timeCell.className = 'record-time';
      timeCell.textContent = formatTime(record.seconds);

      var moveCell = document.createElement('span');
      moveCell.className = 'record-moves';
      moveCell.textContent = record.moves + ' 步';

      var dateCell = document.createElement('span');
      dateCell.className = 'record-date';
      dateCell.textContent = formatDate(record.ts);

      row.appendChild(levelTag);
      row.appendChild(timeCell);
      row.appendChild(moveCell);
      row.appendChild(dateCell);
      recordsList.appendChild(row);
    });
  }

  /* ---------- 打乱与棋盘 ---------- */

  /**
   * 原 App 直接随机排列数字，约有一半概率得到无解盘面。
   * 这里从完成态出发走合法步，保证新盘面一定可解（并且不会一开始就完成）。
   */
  function createShuffledValues(level) {
    var count = level * level;
    var values = [];
    for (var i = 0; i < count; i++) values.push(i);

    var blank = count - 1;
    var steps = count * level * 3;
    for (var step = 0; step < steps; step++) {
      var candidates = neighborsOf(blank, level);
      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      values[blank] = values[pick];
      values[pick] = count - 1;
      blank = pick;
    }

    if (isSolved(values)) {
      var n = neighborsOf(blank, level)[0];
      values[blank] = values[n];
      values[n] = count - 1;
    }
    return values;
  }

  function updateLevelUi(level) {
    var meta = LEVELS[level];
    levelLabel.textContent = meta.name;
    previewImg.src = meta.asset;
    previewImg.alt = level + ' × ' + level + ' 关卡完成示意图';
    levelRows.forEach(function (row) {
      var checked = Number(row.dataset.level) === level;
      row.setAttribute('aria-checked', checked ? 'true' : 'false');
      if (checked) {
        row.setAttribute('aria-current', 'true');
      } else {
        row.removeAttribute('aria-current');
      }
    });
  }

  function selectLevel(level) {
    if (!LEVELS[level]) return;
    state.selectedLevel = level;
    updateLevelUi(level);
  }

  function openModal(modal) {
    state.lastFocus = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(function () {
      var focusable = modal.querySelector('button');
      if (focusable) focusable.focus({ preventScroll: true });
    });
  }

  function closeModal(modal) {
    if (modal.hidden) return;
    modal.hidden = true;
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus({ preventScroll: true });
    }
    state.lastFocus = null;
  }

  function startTimer() {
    stopTimer();
    timerEl.textContent = formatTime(state.elapsed);
    state.timerId = window.setInterval(function () {
      state.elapsed += 1;
      timerEl.textContent = formatTime(state.elapsed);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function buildBoard() {
    board.innerHTML = '';
    state.tiles = {};
    board.style.setProperty('--n', state.level);

    var level = state.level;
    var count = level * level;
    var blankValue = state.blankValue;
    var asset = LEVELS[level].asset;

    for (var cell = 0; cell < count; cell++) {
      var value = state.values[cell];
      if (value === blankValue) continue;

      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.cell = String(cell);
      tile.dataset.value = String(value);
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', '数字 ' + (value + 1));

      var face = document.createElement('div');
      face.className = 'tile-face';
      var cropRow = Math.floor(value / level);
      var cropCol = value % level;
      face.style.backgroundImage = 'url("' + asset + '")';
      face.style.backgroundSize = (level * 100) + '% ' + (level * 100) + '%';
      face.style.backgroundPosition =
        (cropCol / (level - 1)) * 100 + '% ' + (cropRow / (level - 1)) * 100 + '%';

      tile.appendChild(face);
      board.appendChild(tile);
      state.tiles[value] = tile;
      positionTile(tile, cell);
    }
  }

  function positionTile(tile, cell) {
    var level = state.level;
    tile.style.left = (cell % level) / level * 100 + '%';
    tile.style.top = Math.floor(cell / level) / level * 100 + '%';
    tile.dataset.cell = String(cell);
  }

  function updatePositions() {
    for (var cell = 0; cell < state.values.length; cell++) {
      var value = state.values[cell];
      if (value === state.blankValue) continue;
      var tile = state.tiles[value];
      if (tile) positionTile(tile, cell);
    }
  }

  function blankNeighborAxis(cell) {
    var level = state.level;
    var blank = state.blankIndex;
    if (cell === blank) return null;

    var cellRow = Math.floor(cell / level);
    var cellCol = cell % level;
    var blankRow = Math.floor(blank / level);
    var blankCol = blank % level;

    if (cellRow === blankRow && Math.abs(cellCol - blankCol) === 1) {
      return { axis: 'x', sign: blankCol > cellCol ? 1 : -1 };
    }
    if (cellCol === blankCol && Math.abs(cellRow - blankRow) === 1) {
      return { axis: 'y', sign: blankRow > cellRow ? 1 : -1 };
    }
    return null;
  }

  function moveTile(cell) {
    if (!state.playing || state.paused || state.finished) return;
    if (cell < 0 || cell >= state.values.length) return;
    if (state.values[cell] === state.blankValue) return;
    if (!blankNeighborAxis(cell)) return;

    var value = state.values[cell];
    state.values[cell] = state.blankValue;
    state.values[state.blankIndex] = value;
    state.blankIndex = cell;
    state.moves += 1;
    clearHint();
    updatePositions();

    if (isSolved(state.values)) finishGame();
  }

  function finishGame() {
    state.playing = false;
    state.finished = true;
    stopTimer();
    clearHint();
    if (!state.recorded) {
      state.recorded = true;
      addRecord(state.level, state.elapsed, state.moves);
    }
    window.setTimeout(function () {
      if (state.finished) openModal(successModal);
    }, 180);
  }

  function startGame() {
    stopTimer();
    clearHint();
    state.level = state.selectedLevel;
    state.blankValue = state.level * state.level - 1;
    state.values = createShuffledValues(state.level);
    state.blankIndex = state.values.indexOf(state.blankValue);
    state.elapsed = 0;
    state.moves = 0;
    state.recorded = false;
    state.playing = true;
    state.paused = false;
    state.finished = false;
    state.drag = null;

    timerEl.textContent = formatTime(0);
    startView.hidden = true;
    gameView.hidden = false;
    buildBoard();
    startTimer();
  }

  function pauseGame() {
    if (!state.playing || state.paused || state.finished) return;
    state.paused = true;
    state.drag = null;
    clearHint();
    stopTimer();
    openModal(pauseModal);
  }

  function resumeGame() {
    if (!state.playing || state.finished) return;
    closeModal(pauseModal);
    state.paused = false;
    startTimer();
  }

  function resetToStart() {
    stopTimer();
    clearHint();
    state.playing = false;
    state.paused = false;
    state.finished = false;
    state.elapsed = 0;
    state.drag = null;
    timerEl.textContent = formatTime(0);
    board.innerHTML = '';
    state.tiles = {};
    gameView.hidden = true;
    startView.hidden = false;
  }

  function exitGame() {
    closeModal(pauseModal);
    resetToStart();
  }

  /* ---------- 交互：点击 / 拖拽 / 键盘 ---------- */

  function onPointerDown(event) {
    if (!state.playing || state.paused || state.finished || state.drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    var tile = event.target.closest ? event.target.closest('.tile') : null;
    if (!tile) return;

    var cell = Number(tile.dataset.cell);
    var axisInfo = blankNeighborAxis(cell);
    if (!axisInfo) return;

    event.preventDefault();
    if (typeof tile.focus === 'function') tile.focus({ preventScroll: true });

    state.drag = {
      tile: tile,
      cell: cell,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: axisInfo.axis,
      sign: axisInfo.sign,
      cellSize: board.clientWidth / state.level,
      distance: 0
    };
    tile.classList.add('tile--drag');

    try {
      board.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 某些浏览器不支持指针捕获，忽略即可 */
    }
  }

  function onPointerMove(event) {
    var drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    drag.distance = Math.hypot(dx, dy);

    var tx = 0;
    var ty = 0;
    var limit = drag.cellSize;

    if (drag.axis === 'x') {
      tx = drag.sign > 0
        ? Math.min(Math.max(dx, 0), limit)
        : Math.max(Math.min(dx, 0), -limit);
    } else {
      ty = drag.sign > 0
        ? Math.min(Math.max(dy, 0), limit)
        : Math.max(Math.min(dy, 0), -limit);
    }

    drag.tile.style.transform = 'translate3d(' + tx + 'px, ' + ty + 'px, 0)';
    event.preventDefault();
  }

  function endDrag(event) {
    var drag = state.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    state.drag = null;
    drag.tile.classList.remove('tile--drag');
    drag.tile.style.transform = '';

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    var along = drag.axis === 'x' ? dx * drag.sign : dy * drag.sign;
    var distance = Math.hypot(dx, dy);

    if (distance <= 10 || along >= 18) {
      moveTile(drag.cell);
    }

    try {
      if (board.hasPointerCapture(event.pointerId)) {
        board.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      /* 忽略 */
    }
  }

  function cancelDrag(event) {
    var drag = state.drag;
    if (!drag) return;
    if (event && event.pointerId !== drag.pointerId) return;
    state.drag = null;
    drag.tile.classList.remove('tile--drag');
    drag.tile.style.transform = '';
  }

  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', cancelDrag);
  board.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  });
  board.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    var tile = event.target.closest ? event.target.closest('.tile') : null;
    if (!tile) return;
    event.preventDefault();
    moveTile(Number(tile.dataset.cell));
  });

  changeLevelBtn.addEventListener('click', function () {
    updateLevelUi(state.selectedLevel);
    openModal(levelModal);
  });

  levelRows.forEach(function (row) {
    row.addEventListener('click', function () {
      selectLevel(Number(row.dataset.level));
      closeModal(levelModal);
    });
  });

  levelModal.addEventListener('click', function (event) {
    if (event.target === levelModal) closeModal(levelModal);
  });

  startBtn.addEventListener('click', startGame);
  pauseBtn.addEventListener('click', pauseGame);
  resumeBtn.addEventListener('click', resumeGame);
  exitBtn.addEventListener('click', exitGame);
  hintBtn.addEventListener('click', requestHint);

  recordsBtn.addEventListener('click', function () {
    renderRecords();
    openModal(recordsModal);
  });
  closeRecordsBtn.addEventListener('click', function () {
    closeModal(recordsModal);
  });
  recordsModal.addEventListener('click', function (event) {
    if (event.target === recordsModal) closeModal(recordsModal);
  });
  clearRecordsBtn.addEventListener('click', function () {
    if (!loadRecords().length) return;
    if (!window.confirm('确定清空全部游戏记录吗？')) return;
    storeRecords([]);
    renderRecords();
  });

  closeSuccessBtn.addEventListener('click', function () {
    closeModal(successModal);
    resetToStart();
  });
  playAgainBtn.addEventListener('click', function () {
    closeModal(successModal);
    startGame();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!recordsModal.hidden) {
      closeModal(recordsModal);
    } else if (!levelModal.hidden) {
      closeModal(levelModal);
    } else if (!pauseModal.hidden) {
      resumeGame();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.playing && !state.paused && !state.finished) {
      pauseGame();
    }
  });

  /* ---------- 初始化 ---------- */

  selectLevel(3);
  renderRecords();
  Object.keys(LEVELS).forEach(function (level) {
    var image = new Image();
    image.src = LEVELS[level].asset;
  });
})();
