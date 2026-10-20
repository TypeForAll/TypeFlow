
(function () {
  "use strict";

  // =========================================================
  // TYPEFLOW - FIREBASE AUTHENTICATION + CLOUD PROGRESS
  // =========================================================

  var firebaseConfig = {
    apiKey: "AIzaSyBmV96qc0v1aO3KFRrIQ19kJJms9Usz_Jc",
    authDomain: "typeflow-f2e2e.firebaseapp.com",
    projectId: "typeflow-f2e2e",
    storageBucket: "typeflow-f2e2e.firebasestorage.app",
    messagingSenderId: "352541375950",
    appId: "1:352541375950:web:f2bd329bd6a84aaa87ff9f",
    measurementId: "G-KX3HNBNCX1"
  };

  if (!window.firebase) {
    console.error("Firebase scripts are missing. Update index.html first.");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  var auth = firebase.auth();
  var db = firebase.firestore();

  var defaultLessons = [
    "I can type with calm focus.",
    "The blue sky is bright today.",
    "Practice helps my fingers learn.",
    "I read each word before I type.",
    "Small steps make strong skills.",
    "Every lesson builds my confidence."
  ];

  var state = {
    accounts: {},
    currentUser: null,
    mode: "typing",
    activeLesson: 0,
    typingStartedAt: null,
    lastSpokenWordCount: 0,
    puzzleAnswer: [],
    puzzleShuffled: [],
    authReady: false,
    authBusy: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function currentAccount() {
    return state.currentUser
      ? state.accounts[state.currentUser.uid] || null
      : null;
  }

  function createAccount(user, displayName) {
    return {
      uid: user.uid,
      email: user.email || "",
      username: displayName || user.displayName || "",
      customLessons: [],
      completedLessons: [],
      unlockedLessons: [0],
      settings: {
        speakWords: true,
        voiceRate: 0.9
      }
    };
  }

  function normalizeAccount(user, data) {
    var account = createAccount(
      user,
      data.displayName || user.displayName || ""
    );

    account.customLessons = Array.isArray(data.customLessons)
      ? data.customLessons.filter(function (item) {
          return typeof item === "string";
        })
      : [];

    account.completedLessons = Array.isArray(data.completedLessons)
      ? data.completedLessons.filter(Number.isInteger)
      : [];

    account.unlockedLessons = Array.isArray(data.unlockedLessons)
      ? data.unlockedLessons.filter(Number.isInteger)
      : [0];

    if (!account.unlockedLessons.includes(0)) {
      account.unlockedLessons.unshift(0);
    }

    account.settings = Object.assign(
      account.settings,
      data.settings || {}
    );

    if (typeof account.settings.voiceRate !== "number") {
      account.settings.voiceRate = 0.9;
    }

    return account;
  }

  // ---------------------------------------------------------
  // CLOUD SAVING
  // ---------------------------------------------------------

  var saveTimer = null;

  function saveAccounts() {
    var user = state.currentUser;
    var account = currentAccount();

    if (!user || !account) {
      return Promise.resolve();
    }

    var data = {
      displayName: account.username || "",
      email: user.email || "",
      customLessons: account.customLessons,
      completedLessons: account.completedLessons,
      unlockedLessons: account.unlockedLessons,
      settings: account.settings,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    return db.collection("users").doc(user.uid).set(data, {
      merge: true
    }).catch(function (error) {
      console.error("TypeFlow cloud save failed:", error);
      showCloudMessage(
        "Your progress couldn't sync. Check your internet connection.",
        true
      );
    });
  }

  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(function () {
      saveAccounts();
    }, 350);
  }

  function showCloudMessage(message, isError) {
    var target = byId("cloudStatus");

    if (!target) {
      target = document.createElement("p");
      target.id = "cloudStatus";
      target.className = "message";

      var home = byId("homeScreen");
      if (home) {
        home.appendChild(target);
      } else {
        return;
      }
    }

    target.textContent = message;
    target.classList.toggle("error", Boolean(isError));
  }

  async function loadUserData(user) {
    state.currentUser = user;

    var snapshot = await db.collection("users").doc(user.uid).get();

    if (snapshot.exists) {
      state.accounts[user.uid] = normalizeAccount(
        user,
        snapshot.data()
      );
    } else {
      state.accounts[user.uid] = createAccount(
        user,
        user.displayName || ""
      );
    }

    var account = currentAccount();

    if (!account.username) {
      showScreen("nameScreen");
      return;
    }

    // Ensure the document exists for newly created Google accounts.
    await saveAccounts();

    updateGreeting();
    showScreen("homeScreen");
  }

  // ---------------------------------------------------------
  // SCREENS AND MESSAGES
  // ---------------------------------------------------------

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(function (screen) {
      screen.classList.toggle("active", screen.id === id);
    });
  }

  function setMessage(text, isError) {
    var authScreen = byId("authScreen");
    if (!authScreen) return;

    var card = authScreen.querySelector(".auth-card");
    if (!card) return;

    var message = byId("authMessage");

    if (!message) {
      message = document.createElement("p");
      message.id = "authMessage";
      message.className = "message";
      card.appendChild(message);
    }

    message.textContent = text;
    message.classList.toggle("error", Boolean(isError));
  }

  function clearMessage() {
    var message = byId("authMessage");
    if (message) message.remove();
  }

  function authErrorMessage(error) {
    var messages = {
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/email-already-in-use": "An account already exists with that email.",
      "auth/weak-password": "Choose a password with at least 6 characters.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/user-not-found": "No account was found. Try signing up.",
      "auth/wrong-password": "Email or password is incorrect.",
      "auth/network-request-failed": "Connection failed. Check your internet.",
      "auth/popup-closed-by-user": "The Google sign-in window was closed.",
      "auth/popup-blocked": "Your browser blocked the sign-in popup. Try again.",
      "auth/unauthorized-domain": "Add this website's domain to Firebase Authorized domains.",
      "permission-denied": "Firestore blocked access. Check your database rules."
    };

    return messages[error.code] ||
      "Something went wrong: " + (error.message || "Please try again.");
  }

  function updateGreeting() {
    var account = currentAccount();
    var greeting = byId("greeting");

    if (greeting) {
      greeting.textContent = account
        ? "Hello, " + account.username
        : "Hello";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeText(value) {
    return String(value).trim().replace(/\s+/g, " ");
  }

  function allLessons() {
    var account = currentAccount();
    return defaultLessons.concat(
      account ? account.customLessons : []
    );
  }

  function lessonText(index) {
    return allLessons()[index] || "";
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;

    var account = currentAccount();
    var utterance = new SpeechSynthesisUtterance(text);

    utterance.rate =
      account && account.settings
        ? account.settings.voiceRate
        : 0.9;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  // ---------------------------------------------------------
  // AUTHENTICATION
  // ---------------------------------------------------------

  window.showTab = function (tabName) {
    clearMessage();

    if (byId("loginTab")) {
      byId("loginTab").classList.toggle(
        "active",
        tabName === "login"
      );
    }

    if (byId("signupTab")) {
      byId("signupTab").classList.toggle(
        "active",
        tabName === "signup"
      );
    }

    document.querySelectorAll(".tabs button").forEach(function (button) {
      var label = button.textContent
        .toLowerCase()
        .replace(/\s+/g, "");

      button.classList.toggle("active", label === tabName);
    });
  };

  window.signup = async function () {
    if (state.authBusy) return;

    var email = byId("signupEmail");
    var password = byId("signupPass");

    if (!email || !password) {
      setMessage("The updated signup fields are missing from index.html.", true);
      return;
    }

    var emailValue = email.value.trim();
    var passwordValue = password.value;

    if (!emailValue || !passwordValue) {
      setMessage("Enter your email and password.", true);
      return;
    }

    if (passwordValue.length < 6) {
      setMessage("Your password must have at least 6 characters.", true);
      return;
    }

    state.authBusy = true;

    try {
      var result = await auth.createUserWithEmailAndPassword(
        emailValue,
        passwordValue
      );

      state.currentUser = result.user;
      state.accounts[result.user.uid] = createAccount(
        result.user,
        ""
      );

      if (email) email.value = "";
      if (password) password.value = "";

      if (byId("displayNameInput")) {
        byId("displayNameInput").value = "";
      }

      showScreen("nameScreen");
    } catch (error) {
      setMessage(authErrorMessage(error), true);
    } finally {
      state.authBusy = false;
    }
  };

  window.login = async function () {
    if (state.authBusy) return;

    var email = byId("loginEmail");
    var password = byId("loginPass");

    if (!email || !password) {
      setMessage("The updated login fields are missing from index.html.", true);
      return;
    }

    state.authBusy = true;

    try {
      await auth.signInWithEmailAndPassword(
        email.value.trim(),
        password.value
      );

      email.value = "";
      password.value = "";
      clearMessage();
    } catch (error) {
      setMessage(authErrorMessage(error), true);
    } finally {
      state.authBusy = false;
    }
  };

  window.googleLogin = async function () {
    if (state.authBusy) return;

    state.authBusy = true;

    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      await auth.signInWithPopup(provider);
    } catch (error) {
      if (error.code === "auth/popup-blocked") {
        try {
          await auth.signInWithRedirect(
            new firebase.auth.GoogleAuthProvider()
          );
        } catch (redirectError) {
          setMessage(authErrorMessage(redirectError), true);
        }
      } else if (error.code !== "auth/popup-closed-by-user") {
        setMessage(authErrorMessage(error), true);
      }
    } finally {
      state.authBusy = false;
    }
  };

  window.saveDisplayName = async function () {
    var input = byId("displayNameInput");
    var name = input ? normalizeText(input.value) : "";
    var user = state.currentUser;

    if (!user) {
      setMessage("Please sign in again.", true);
      showScreen("authScreen");
      return;
    }

    if (!name) {
      alert("Please choose a display name.");
      if (input) input.focus();
      return;
    }

    if (name.length > 40) {
      alert("Your display name must be 40 characters or fewer.");
      return;
    }

    try {
      await user.updateProfile({ displayName: name });

      var account = currentAccount() || createAccount(user, name);
      account.username = name;
      state.accounts[user.uid] = account;

      await saveAccounts();
      updateGreeting();
      showScreen("homeScreen");
    } catch (error) {
      setMessage(authErrorMessage(error), true);
    }
  };

  window.logout = async function () {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    try {
      await auth.signOut();
      state.activeLesson = 0;
      state.puzzleAnswer = [];
      showScreen("authScreen");
      window.showTab("login");
    } catch (error) {
      alert(authErrorMessage(error));
    }
  };

  // ---------------------------------------------------------
  // TYPING LESSONS
  // ---------------------------------------------------------

  function ensureProgressBar() {
    var typingScreen = byId("typingScreen");
    if (!typingScreen) return;

    var box = typingScreen.querySelector(".lesson-box");
    var input = byId("typingInput");
    var progress = byId("typingProgressWrap");

    if (!box || !input || progress) return;

    progress = document.createElement("div");
    progress.id = "typingProgressWrap";
    progress.className = "progress-wrap";

    progress.innerHTML =
      '<div class="progress-label">' +
        "<span>Progress</span>" +
        '<span id="progressText">0%</span>' +
      "</div>" +
      '<div class="progress-track">' +
        '<div id="progressFill" class="progress-fill"></div>' +
      "</div>";

    box.insertBefore(progress, input);
  }

  function setProgress(percent) {
    var safePercent = Math.max(
      0,
      Math.min(100, Math.round(percent))
    );

    var fill = byId("progressFill");
    var text = byId("progressText");

    if (fill) fill.style.width = safePercent + "%";
    if (text) text.textContent = safePercent + "%";
  }

  function renderSentenceHighlight() {
    var sentence = byId("sentence");
    var input = byId("typingInput");

    if (!sentence || !input) return;

    var target = lessonText(state.activeLesson);
    var typed = input.value;
    var html = "";

    for (var index = 0; index < target.length; index += 1) {
      var className = "char";

      if (index < typed.length) {
        className += typed[index] === target[index]
          ? " correct"
          : " incorrect";
      } else if (index === typed.length) {
        className += " current";
      }

      html += '<span class="' + className + '">' +
        escapeHtml(target[index]) +
        "</span>";
    }

    sentence.innerHTML = html;
  }

  function updateTypingStats() {
    var input = byId("typingInput");
    if (!input) return;

    var target = lessonText(state.activeLesson);
    var typed = input.value;
    var correctCount = 0;

    for (var index = 0; index < typed.length; index += 1) {
      if (typed[index] === target[index]) {
        correctCount += 1;
      }
    }

    var accuracy = typed.length
      ? Math.round((correctCount / typed.length) * 100)
      : 100;

    var elapsedMinutes = state.typingStartedAt
      ? (Date.now() - state.typingStartedAt) / 60000
      : 0;

    var wordsTyped = typed.trim()
      ? typed.trim().split(/\s+/).length
      : 0;

    var wpm = elapsedMinutes > 0
      ? Math.round(wordsTyped / elapsedMinutes)
      : 0;

    var progress = target.length
      ? Math.min(typed.length, target.length) / target.length * 100
      : 0;

    if (byId("accuracy")) {
      byId("accuracy").textContent = "Accuracy: " + accuracy + "%";
    }

    if (byId("wpm")) {
      byId("wpm").textContent = "WPM: " + wpm;
    }

    setProgress(progress);
    renderSentenceHighlight();
  }

  function completedWordFromTyping() {
    var input = byId("typingInput");
    if (!input) return;

    var value = input.value;
    var words = value.trim().split(/\s+/).filter(Boolean);

    if (!value.endsWith(" ") || words.length <= state.lastSpokenWordCount) {
      return;
    }

    state.lastSpokenWordCount = words.length;
    speak(words[words.length - 1]);
  }

  function markLessonComplete(index) {
    var account = currentAccount();
    if (!account) return;

    if (!account.completedLessons.includes(index)) {
      account.completedLessons.push(index);
    }

    if (
      index + 1 < allLessons().length &&
      !account.unlockedLessons.includes(index + 1)
    ) {
      account.unlockedLessons.push(index + 1);
    }

    scheduleSave();
  }

  function isUnlocked(index) {
    var account = currentAccount();
    return Boolean(account && account.unlockedLessons.includes(index));
  }

  function showCompletion(isFinal, keepGoingHandlerName, keepGoingLabel) {
    var finalScreen = byId("finalScreen");
    if (!finalScreen) return;

    var finalCard = finalScreen.querySelector(".final-card");
    if (!finalCard) return;

    finalCard.innerHTML = [
      "<h1>" + (isFinal ? "Congratulations!" : "Good Job!") + "</h1>",
      '<div class="stars" aria-label="Three completion stars">★ ★ ★</div>',
      "<p>" + (
        isFinal
          ? "You finished every unlocked lesson."
          : "You completed this lesson."
      ) + "</p>",
      '<div class="final-actions">',
      isFinal
        ? ""
        : '<button onclick="' + keepGoingHandlerName + '()">' +
          keepGoingLabel + "</button>",
      '<button class="secondary" onclick="backHome()">Main Menu</button>',
      "</div>"
    ].join("");

    showScreen("finalScreen");
  }

  function renderLessonMenu() {
    var grid = byId("lessonGrid");
    var account = currentAccount();

    if (!grid) return;

    var lessons = allLessons();
    var heading = byId("lessonScreen")
      ? byId("lessonScreen").querySelector("h2")
      : null;

    if (heading) {
      heading.textContent = state.mode === "puzzle"
        ? "Sentence Puzzles"
        : "Typing Lessons";
    }

    grid.innerHTML = "";

    lessons.forEach(function (lesson, index) {
      var unlocked = isUnlocked(index);
      var completed = account &&
        account.completedLessons.includes(index);

      var card = document.createElement("div");
      card.className = "lesson-card" + (unlocked ? "" : " locked");
      card.tabIndex = unlocked ? 0 : -1;
      card.setAttribute("role", "button");
      card.setAttribute(
        "aria-label",
        unlocked
          ? "Open lesson " + (index + 1)
          : "Lesson " + (index + 1) + " is locked"
      );

      card.innerHTML = [
        '<div class="lesson-top">',
        '<span class="lesson-number">' + (index + 1) + "</span>",
        '<span class="lesson-status">' +
          (completed ? "★" : unlocked ? "→" : "🔒") +
        "</span>",
        "</div>",
        "<h3>Lesson " + (index + 1) + "</h3>",
        '<p class="lesson-preview">' + escapeHtml(lesson) + "</p>",
        '<div class="lesson-meta">' +
          (completed ? "Completed" : unlocked ? "Ready" : "Locked") +
        "</div>"
      ].join("");

      if (unlocked) {
        card.addEventListener("click", function () {
          openLesson(index);
        });

        card.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLesson(index);
          }
        });
      }

      grid.appendChild(card);
    });
  }

  function openLesson(index) {
    state.activeLesson = index;

    if (state.mode === "puzzle") {
      startPuzzle(index);
    } else {
      startTyping(index);
    }
  }

  function startTyping(index) {
    state.activeLesson = index;
    state.typingStartedAt = null;
    state.lastSpokenWordCount = 0;

    ensureProgressBar();

    if (byId("typingInput")) {
      byId("typingInput").value = "";
    }

    updateTypingStats();
    showScreen("typingScreen");

    if (byId("typingInput")) {
      byId("typingInput").focus();
    }
  }

  // ---------------------------------------------------------
  // SENTENCE PUZZLES
  // ---------------------------------------------------------

  function shuffleWords(words) {
    var shuffled = words.slice();

    for (var index = shuffled.length - 1; index > 0; index -= 1) {
      var randomIndex = Math.floor(Math.random() * (index + 1));
      var temp = shuffled[index];
      shuffled[index] = shuffled[randomIndex];
      shuffled[randomIndex] = temp;
    }

    return shuffled;
  }

  function buildWordTile(word, originalIndex, inAnswer) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "word-tile" + (inAnswer ? " in-answer" : "");
    tile.textContent = word;
    tile.dataset.word = word;
    tile.dataset.originalIndex = String(originalIndex);

    tile.addEventListener("click", function () {
      speak(word);

      if (inAnswer) {
        state.puzzleAnswer = state.puzzleAnswer.filter(function (item) {
          return item.id !== originalIndex;
        });
      } else {
        state.puzzleAnswer.push({
          id: originalIndex,
          word: word
        });
      }

      renderPuzzle();
    });

    return tile;
  }

  function currentPuzzleWords() {
    return lessonText(state.activeLesson)
      .split(/\s+/)
      .filter(Boolean);
  }

  function renderPuzzle() {
    var wordBank = byId("wordBank");
    var answerArea = byId("answerArea");

    if (!wordBank || !answerArea) return;

    var selectedIds = state.puzzleAnswer.map(function (item) {
      return item.id;
    });

    wordBank.innerHTML = "";
    answerArea.innerHTML = "";

    state.puzzleShuffled.forEach(function (item) {
      if (!selectedIds.includes(item.id)) {
        wordBank.appendChild(
          buildWordTile(item.word, item.id, false)
        );
      }
    });

    state.puzzleAnswer.forEach(function (item) {
      answerArea.appendChild(
        buildWordTile(item.word, item.id, true)
      );
    });

    if (!wordBank.children.length) {
      wordBank.innerHTML =
        '<span class="lesson-meta">All words are in the answer area.</span>';
    }

    if (!answerArea.children.length) {
      answerArea.innerHTML =
        '<span class="lesson-meta">Click words in order to build the sentence.</span>';
    }
  }

  function startPuzzle(index) {
    var words = lessonText(index).split(/\s+/).filter(Boolean);

    state.activeLesson = index;
    state.puzzleAnswer = [];

    state.puzzleShuffled = shuffleWords(
      words.map(function (word, wordIndex) {
        return { id: wordIndex, word: word };
      })
    );

    renderPuzzle();
    showScreen("puzzleScreen");
  }

  // ---------------------------------------------------------
  // CUSTOM LESSON EDITOR
  // ---------------------------------------------------------

  function renderEditor() {
    var list = byId("customLessons");
    var account = currentAccount();

    if (!list) return;

    list.innerHTML = "";

    if (!account || !account.customLessons.length) {
      list.innerHTML =
        '<p class="lesson-meta">No custom lessons yet.</p>';
      return;
    }

    account.customLessons.forEach(function (lesson, index) {
      var row = document.createElement("div");
      row.className = "editor-row";

      var input = document.createElement("input");
      input.value = lesson;
      input.setAttribute(
        "aria-label",
        "Custom lesson " + (index + 1)
      );

      var saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "Save";
      saveButton.addEventListener("click", function () {
        window.editLesson(index, input.value);
      });

      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", function () {
        window.deleteLesson(index);
      });

      row.appendChild(input);
      row.appendChild(saveButton);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });
  }

  function syncLessonAccessAfterLessonChange() {
    var account = currentAccount();
    if (!account) return;

    var count = allLessons().length;

    account.completedLessons = account.completedLessons.filter(function (index) {
      return index < count;
    });

    account.unlockedLessons = account.unlockedLessons.filter(function (index) {
      return index < count;
    });

    if (!account.unlockedLessons.includes(0)) {
      account.unlockedLessons.push(0);
    }
  }

  // ---------------------------------------------------------
  // NAVIGATION
  // ---------------------------------------------------------

  window.openTyping = function () {
    state.mode = "typing";
    renderLessonMenu();
    showScreen("lessonScreen");
  };

  window.openPuzzle = function () {
    state.mode = "puzzle";
    renderLessonMenu();
    showScreen("lessonScreen");
  };

  window.openEditor = function () {
    renderEditor();
    showScreen("editorScreen");
  };

  window.backHome = function () {
    updateGreeting();
    showScreen("homeScreen");
  };

  window.backLessons = function () {
    renderLessonMenu();
    showScreen("lessonScreen");
  };

  window.speakSentence = function () {
    speak(lessonText(state.activeLesson));
  };

  // ---------------------------------------------------------
  // CHECKING TYPING AND PUZZLES
  // ---------------------------------------------------------

  window.checkTyping = function () {
    var target = normalizeText(lessonText(state.activeLesson));
    var input = byId("typingInput");
    if (!input) return;

    var typed = normalizeText(input.value);
    var isCorrect = typed === target;

    updateTypingStats();

    if (!isCorrect) {
      input.focus();
      return;
    }

    markLessonComplete(state.activeLesson);

    showCompletion(
      state.activeLesson >= allLessons().length - 1,
      "nextLesson",
      "Next Lesson"
    );
  };

  window.nextLesson = function () {
    var account = currentAccount();

    if (!account || !account.completedLessons.includes(state.activeLesson)) {
      window.checkTyping();
      return;
    }

    var nextIndex = state.activeLesson + 1;

    if (nextIndex >= allLessons().length) {
      showCompletion(true, "nextLesson", "Next Lesson");
      return;
    }

    startTyping(nextIndex);
  };

  window.checkPuzzle = function () {
    var expected = normalizeText(lessonText(state.activeLesson));
    var answer = normalizeText(
      state.puzzleAnswer.map(function (item) {
        return item.word;
      }).join(" ")
    );

    if (answer !== expected) {
      var answerArea = byId("answerArea");

      if (answerArea && answerArea.animate) {
        answerArea.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-8px)" },
            { transform: "translateX(8px)" },
            { transform: "translateX(0)" }
          ],
          { duration: 220 }
        );
      }

      return;
    }

    markLessonComplete(state.activeLesson);

    showCompletion(
      state.activeLesson >= allLessons().length - 1,
      "nextPuzzle",
      "Keep Going"
    );
  };

  window.nextPuzzle = function () {
    var account = currentAccount();

    if (!account || !account.completedLessons.includes(state.activeLesson)) {
      window.checkPuzzle();
      return;
    }

    var nextIndex = state.activeLesson + 1;

    if (nextIndex >= allLessons().length) {
      showCompletion(true, "nextPuzzle", "Keep Going");
      return;
    }

    startPuzzle(nextIndex);
  };

  // ---------------------------------------------------------
  // CUSTOM LESSON ACTIONS
  // ---------------------------------------------------------

  window.addLesson = function () {
    var input = byId("newLessonText");
    var account = currentAccount();

    if (!input || !account) return;

    var sentence = normalizeText(input.value);

    if (!sentence) {
      input.focus();
      return;
    }

    account.customLessons.push(sentence);
    syncLessonAccessAfterLessonChange();
    scheduleSave();

    input.value = "";
    renderEditor();
  };

  window.editLesson = function (customIndex, value) {
    var account = currentAccount();
    var sentence = normalizeText(value);

    if (!account || !sentence) return;
    if (customIndex < 0 || customIndex >= account.customLessons.length) return;

    account.customLessons[customIndex] = sentence;
    scheduleSave();
    renderEditor();
  };

  window.deleteLesson = function (customIndex) {
    var account = currentAccount();

    if (!account) return;
    if (customIndex < 0 || customIndex >= account.customLessons.length) return;

    account.customLessons.splice(customIndex, 1);
    syncLessonAccessAfterLessonChange();
    scheduleSave();
    renderEditor();
  };

  // ---------------------------------------------------------
  // SETTINGS SUPPORT
  // ---------------------------------------------------------

  window.setSpeakWords = function (enabled) {
    var account = currentAccount();
    if (!account) return;

    account.settings.speakWords = Boolean(enabled);
    scheduleSave();
  };

  window.setVoiceRate = function (rate) {
    var account = currentAccount();
    if (!account) return;

    var value = Number(rate);
    if (!Number.isFinite(value)) return;

    account.settings.voiceRate = Math.max(0.5, Math.min(2, value));
    scheduleSave();
  };

  // ---------------------------------------------------------
  // EVENTS AND INITIALIZATION
  // ---------------------------------------------------------

  function bindEvents() {
    var typingInput = byId("typingInput");

    if (typingInput) {
      typingInput.addEventListener("input", function () {
        if (!state.typingStartedAt && typingInput.value.length) {
          state.typingStartedAt = Date.now();
        }

        updateTypingStats();

        if (
          normalizeText(typingInput.value) ===
          normalizeText(lessonText(state.activeLesson))
        ) {
          markLessonComplete(state.activeLesson);

          showCompletion(
            state.activeLesson >= allLessons().length - 1,
            "nextLesson",
            "Next Lesson"
          );
        }
      });

      typingInput.addEventListener("keyup", function (event) {
        if (event.key === " ") {
          completedWordFromTyping();
        }
      });
    }

    var newLessonText = byId("newLessonText");

    if (newLessonText) {
      newLessonText.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          window.addLesson();
        }
      });
    }

    var displayNameInput = byId("displayNameInput");

    if (displayNameInput) {
      displayNameInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          window.saveDisplayName();
        }
      });
    }
  }

  function init() {
    bindEvents();

    if (typeof window.showTab === "function") {
      window.showTab("login");
    }

    auth.getRedirectResult().catch(function (error) {
      setMessage(authErrorMessage(error), true);
    });

    auth.onAuthStateChanged(async function (user) {
      state.currentUser = user;

      if (!user) {
        state.accounts = {};
        state.authReady = true;
        showScreen("authScreen");

        if (typeof window.showTab === "function") {
          window.showTab("login");
        }

        return;
      }

      try {
        await loadUserData(user);
        state.authReady = true;
      } catch (error) {
        console.error("TypeFlow could not load the account:", error);
        state.authReady = true;
        showScreen("authScreen");
        setMessage(authErrorMessage(error), true);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
}());
