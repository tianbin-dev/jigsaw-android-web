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
    lastFocus: null
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
    updatePositions();

    if (isSolved(state.values)) finishGame();
  }

  function finishGame() {
    state.playing = false;
    state.finished = true;
    stopTimer();
    window.setTimeout(function () {
      if (state.finished) openModal(successModal);
    }, 180);
  }

  function startGame() {
    stopTimer();
    state.level = state.selectedLevel;
    state.blankValue = state.level * state.level - 1;
    state.values = createShuffledValues(state.level);
    state.blankIndex = state.values.indexOf(state.blankValue);
    state.elapsed = 0;
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
    if (!levelModal.hidden) {
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
  Object.keys(LEVELS).forEach(function (level) {
    var image = new Image();
    image.src = LEVELS[level].asset;
  });
})();
