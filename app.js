
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

  var DEMO_USER = "TEST-e232";
  var DEMO_PASS = "14334";
  var DEMO_UID = "typeflow-demo";

  if (!window.firebase) {
    console.error("Firebase scripts are missing from index.html.");
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
    authBusy: false,
    demo: false,
    deferredInstallPrompt: null,
    serviceWorkerRegistration: null
  };

  var demoAccount = null;
  var saveTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function firstId() {
    for (var i = 0; i < arguments.length; i++) {
      var element = byId(arguments[i]);
      if (element) return element;
    }
    return null;
  }

  function currentAccount() {
    return state.currentUser
      ? state.accounts[state.currentUser.uid] || null
      : null;
  }

  function isDemo() {
    return !!(
      state.demo &&
      state.currentUser &&
      state.currentUser.uid === DEMO_UID
    );
  }

  function createAccount(user, name) {
    return {
      uid: user.uid,
      email: user.email || "",
      username: name || user.displayName || "",
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
    data = data || {};

    var account = createAccount(
      user,
      data.displayName || data.username || user.displayName || ""
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
      {},
      account.settings,
      data.settings || {}
    );

    account.settings.speakWords =
      account.settings.speakWords !== false;

    var rate = Number(account.settings.voiceRate);

    account.settings.voiceRate = Number.isFinite(rate)
      ? Math.max(0.5, Math.min(2, rate))
      : 0.9;

    return account;
  }

  function showCloudMessage(message, error) {
    var element = byId("cloudStatus");

    if (!element) {
      element = document.createElement("p");
      element.id = "cloudStatus";
      element.className = "message";

      var home = byId("homeScreen");
      if (!home) return;

      home.appendChild(element);
    }

    element.textContent = message;
    element.classList.toggle("error", !!error);
  }

  function saveAccounts() {
    var user = state.currentUser;
    var account = currentAccount();

    if (!user || !account || isDemo()) {
      return Promise.resolve();
    }

    return db.collection("users").doc(user.uid).set(
      {
        displayName: account.username || "",
        email: user.email || "",
        customLessons: account.customLessons,
        completedLessons: account.completedLessons,
        unlockedLessons: account.unlockedLessons,
        settings: account.settings,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    ).then(function () {
      showCloudMessage("Progress saved to your account.", false);
    }).catch(function (error) {
      console.error("TypeFlow cloud save failed:", error);
      showCloudMessage(
        "Your progress couldn't sync. Check your internet connection.",
        true
      );
      throw error;
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;

    if (!isDemo()) {
      saveTimer = setTimeout(function () {
        saveTimer = null;
        saveAccounts().catch(function () {});
      }, 350);
    }
  }

  async function loadUserData(user) {
    state.currentUser = user;
    state.demo = false;

    var snapshot = await db.collection("users").doc(user.uid).get();

    state.accounts[user.uid] = snapshot.exists
      ? normalizeAccount(user, snapshot.data())
      : createAccount(user, user.displayName || "");

    bindSettingsControls();
    addAccountSettings();
    addPwaSettings();

    var account = currentAccount();

    if (!account.username) {
      showScreen("nameScreen");
      return;
    }

    await saveAccounts();
    updateGreeting();
    renderLessonMenu();
    renderEditor();
    showScreen("homeScreen");
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(function (screen) {
      screen.classList.toggle("active", screen.id === id);
    });
  }

  function setMessage(message, error) {
    var screen = byId("authScreen");
    if (!screen) return;

    var card = screen.querySelector(".auth-card");
    if (!card) return;

    var element = byId("authMessage");

    if (!element) {
      element = document.createElement("p");
      element.id = "authMessage";
      element.className = "message";
      card.appendChild(element);
    }

    element.textContent = message;
    element.classList.toggle("error", !!error);
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

    return messages[error && error.code] ||
      "Something went wrong: " +
      ((error && error.message) || "Please try again.");
  }

  function updateGreeting() {
    var account = currentAccount();
    var greeting = byId("greeting");

    if (greeting) {
      greeting.textContent = account
        ? "Hello, " + (account.username || "there")
        : "Hello";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

    if (account && account.settings.speakWords === false) return;

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = account && account.settings
      ? account.settings.voiceRate
      : 0.9;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function enterDemo() {
    if (!demoAccount) {
      demoAccount = createAccount(
        { uid: DEMO_UID, email: "", displayName: "Demo" },
        "Demo"
      );
    }

    state.demo = true;
    state.currentUser = {
      uid: DEMO_UID,
      email: "",
      displayName: "Demo"
    };

    state.accounts = {};
    state.accounts[DEMO_UID] = demoAccount;
    state.activeLesson = 0;
    state.puzzleAnswer = [];

    clearMessage();
    bindSettingsControls();
    addAccountSettings();
    addPwaSettings();
    updateGreeting();
    renderLessonMenu();
    renderEditor();

    showCloudMessage(
      "Demo account: progress is temporary and isn't uploaded.",
      false
    );

    showScreen("homeScreen");
  }

  window.showTab = function (tab) {
    clearMessage();

    var loginTab = byId("loginTab");
    var signupTab = byId("signupTab");

    if (loginTab) loginTab.classList.toggle("active", tab === "login");
    if (signupTab) signupTab.classList.toggle("active", tab === "signup");

    document.querySelectorAll(".tabs button").forEach(function (button) {
      button.classList.toggle(
        "active",
        button.textContent.toLowerCase().replace(/\s+/g, "") === tab
      );
    });
  };

  window.signup = async function () {
    if (state.authBusy) return;

    var userField = firstId("signupEmail", "signupUser");
    var passwordField = byId("signupPass");

    if (!userField || !passwordField) {
      setMessage("Signup fields are missing from index.html.", true);
      return;
    }

    var identifier = userField.value.trim();
    var password = passwordField.value;

    if (!identifier || !password) {
      setMessage("Enter your email and password.", true);
      return;
    }

    if (password.length < 6) {
      setMessage("Your password must have at least 6 characters.", true);
      return;
    }

    if (!identifier.includes("@")) {
      setMessage(
        "Regular cloud accounts need an email address. Use the demo login for a username-only test.",
        true
      );
      return;
    }

    state.authBusy = true;

    try {
      var result = await auth.createUserWithEmailAndPassword(
        identifier,
        password
      );

      state.currentUser = result.user;
      state.demo = false;
      state.accounts[result.user.uid] = createAccount(result.user, "");

      userField.value = "";
      passwordField.value = "";

      showScreen("nameScreen");
    } catch (error) {
      setMessage(authErrorMessage(error), true);
    } finally {
      state.authBusy = false;
    }
  };

  window.login = async function () {
    if (state.authBusy) return;

    var userField = firstId("loginEmail", "loginUser");
    var passwordField = byId("loginPass");

    if (!userField || !passwordField) {
      setMessage("Login fields are missing from index.html.", true);
      return;
    }

    var identifier = userField.value.trim();
    var password = passwordField.value;

    if (identifier === DEMO_USER && password === DEMO_PASS) {
      userField.value = "";
      passwordField.value = "";
      enterDemo();
      return;
    }

    if (!identifier || !password) {
      setMessage("Enter your email and password.", true);
      return;
    }

    if (!identifier.includes("@")) {
      setMessage(
        "Regular accounts use the email address connected to Firebase. Demo login: TEST-e232 / 14334.",
        true
      );
      return;
    }

    state.authBusy = true;

    try {
      await auth.signInWithEmailAndPassword(identifier, password);

      userField.value = "";
      passwordField.value = "";
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

    var account = currentAccount();

    if (!account) {
      account = createAccount(user, name);
      state.accounts[user.uid] = account;
    }

    account.username = name;

    if (isDemo()) {
      demoAccount = account;
    } else {
      try {
        if (user.updateProfile) {
          await user.updateProfile({ displayName: name });
        }
        await saveAccounts();
      } catch (error) {
        setMessage(authErrorMessage(error), true);
        return;
      }
    }

    bindSettingsControls();
    addAccountSettings();
    updateGreeting();
    renderLessonMenu();
    renderEditor();
    showScreen("homeScreen");
  };

  // Change the display name from Settings after signup.
  window.saveSettingsDisplayName = async function () {
    var input = byId("settingsDisplayName");
    var name = input ? normalizeText(input.value) : "";
    var user = state.currentUser;
    var account = currentAccount();

    if (!user || !account) {
      alert("Please sign in before changing your display name.");
      return;
    }

    if (!name) {
      alert("Please enter a display name.");
      if (input) input.focus();
      return;
    }

    if (name.length > 40) {
      alert("Your display name must be 40 characters or fewer.");
      return;
    }

    var oldName = account.username;
    account.username = name;

    try {
      if (!isDemo() && user.updateProfile) {
        await user.updateProfile({ displayName: name });
      }

      if (isDemo()) {
        demoAccount = account;
      } else {
        await saveAccounts();
      }

      updateGreeting();

      var status = byId("settingsNameStatus");
      if (status) {
        status.textContent = "Display name saved.";
      }
    } catch (error) {
      account.username = oldName;
      if (input) input.value = oldName;
      alert(authErrorMessage(error));
    }
  };

  // Add a display-name editor to the existing Settings panel.
  function findSettingsContainer() {
    return document.querySelector(
      "#settingsOverlay .settings-card, " +
      "#settingsModal .settings-card, " +
      "#settingsOverlay .settings-content, " +
      "#settingsModal .settings-content, " +
      "#settingsOverlay, #settingsModal, " +
      ".settings-card, .settings-content"
    );
  }

  function addAccountSettings() {
    var container = findSettingsContainer();
    var account = currentAccount();

    if (!container || !account) return;

    var section = byId("typeflowAccountSettings");

    if (!section) {
      section = document.createElement("section");
      section.id = "typeflowAccountSettings";
      section.style.marginTop = "20px";
      section.style.paddingTop = "16px";
      section.style.borderTop = "1px solid #ddd";

      section.innerHTML =
        '<h3>Account</h3>' +
        '<label for="settingsDisplayName">Display name</label>' +
        '<input id="settingsDisplayName" type="text" maxlength="40" ' +
        'autocomplete="nickname" placeholder="Your display name" ' +
        'style="display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;">' +
        '<button id="saveSettingsDisplayName" type="button">Save display name</button>' +
        '<p id="settingsNameStatus" role="status" aria-live="polite"></p>';

      container.appendChild(section);

      byId("saveSettingsDisplayName").addEventListener("click", function () {
        window.saveSettingsDisplayName();
      });

      byId("settingsDisplayName").addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          window.saveSettingsDisplayName();
        }
      });
    }

    var nameInput = byId("settingsDisplayName");
    if (nameInput) nameInput.value = account.username || "";
  }

  window.logout = async function () {
    if (isDemo()) {
      state.demo = false;
      state.currentUser = null;
      state.accounts = {};
      demoAccount = null;
      clearMessage();
      showScreen("authScreen");
      window.showTab("login");
      return;
    }

    try {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await saveAccounts();
      }

      await auth.signOut();
    } catch (error) {
      setMessage(authErrorMessage(error), true);
    }
  };

  function updateTypingStats() {
    var input = byId("typingInput");
    if (!input) return;

    var typed = input.value;
    var words = typed.trim() ? typed.trim().split(/\s+/).length : 0;
    var accuracy = 0;

    if (typed.length) {
      var target = lessonText(state.activeLesson);
      var correct = 0;

      for (var i = 0; i < Math.min(typed.length, target.length); i++) {
        if (typed[i] === target[i]) correct++;
      }

      accuracy = Math.round((correct / typed.length) * 100);
    }

    var accuracyElement = byId("accuracy");
    var wpmElement = byId("wpm");

    if (accuracyElement) accuracyElement.textContent = accuracy + "%";

    if (wpmElement) {
      var elapsed = state.typingStartedAt
        ? (Date.now() - state.typingStartedAt) / 60000
        : 0;

      var wpm = elapsed > 0 ? Math.round(words / elapsed) : 0;
      wpmElement.textContent = wpm + " WPM";
    }

    var progress = byId("typeflowProgress");
    var fill = progress ? progress.querySelector(".progress-fill") : null;

    if (fill) {
      var targetLength = lessonText(state.activeLesson).length;
      var percent = targetLength
        ? Math.min(100, (typed.length / targetLength) * 100)
        : 0;

      fill.style.width = percent + "%";
      progress.setAttribute("aria-valuenow", String(Math.round(percent)));
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
    }
  }

  function completedWordFromTyping() {
    var input = byId("typingInput");
    if (!input) return;

    var words = input.value.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;

    var count = words.length;

    if (count > state.lastSpokenWordCount) {
      speak(words[count - 1]);
      state.lastSpokenWordCount = count;
    }
  }

  function ensureProgressBar() {
    var screen = byId("typingScreen");
    if (!screen || byId("typeflowProgress")) return;

    var bar = document.createElement("div");
    bar.id = "typeflowProgress";
    bar.className = "progress-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Typing progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    bar.innerHTML = '<div class="progress-fill"></div>';

    var sentence = byId("sentence");

    if (sentence && sentence.parentNode) {
      sentence.parentNode.insertBefore(bar, sentence.nextSibling);
    } else {
      screen.appendChild(bar);
    }
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

  function showCompletion(final, handler, label) {
    var screen = byId("finalScreen");
    if (!screen) return;

    var card = screen.querySelector(".final-card");
    if (!card) return;

    card.innerHTML =
      "<h1>" + (final ? "Congratulations!" : "Good Job!") + "</h1>" +
      '<div class="stars" aria-label="Three completion stars">★ ★ ★</div>' +
      "<p>" +
      (final
        ? "You finished every unlocked lesson."
        : "You completed this lesson.") +
      "</p>" +
      '<div class="final-actions">' +
      (final
        ? ""
        : '<button onclick="' + handler + '()">' + label + "</button>") +
      '<button class="secondary" onclick="backHome()">Main Menu</button>' +
      "</div>";

    showScreen("finalScreen");
  }

  function renderLessonMenu() {
    var grid = byId("lessonGrid");
    var account = currentAccount();

    if (!grid) return;

    var lessons = allLessons();
    var screen = byId("lessonScreen");
    var heading = screen ? screen.querySelector("h2") : null;

    if (heading) {
      heading.textContent =
        state.mode === "puzzle" ? "Sentence Puzzles" : "Typing Lessons";
    }

    grid.innerHTML = "";

    lessons.forEach(function (lesson, index) {
      var unlocked = isUnlocked(index);
      var completed = account && account.completedLessons.includes(index);
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

      card.innerHTML =
        '<div class="lesson-top"><span class="lesson-number">' +
        (index + 1) +
        '</span><span class="lesson-status">' +
        (completed ? "★" : unlocked ? "→" : "🔒") +
        "</span></div><h3>Lesson " +
        (index + 1) +
        '</h3><p class="lesson-preview">' +
        escapeHtml(lesson) +
        '</p><div class="lesson-meta">' +
        (completed ? "Completed" : unlocked ? "Ready" : "Locked") +
        "</div>";

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

  function isUnlocked(index) {
    var account = currentAccount();
    return !!(account && account.unlockedLessons.includes(index));
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

    if (byId("sentence")) {
      byId("sentence").textContent = lessonText(index);
    }

    if (byId("typingInput")) {
      byId("typingInput").value = "";
    }

    updateTypingStats();
    showScreen("typingScreen");

    if (byId("typingInput")) byId("typingInput").focus();
  }

  function shuffleWords(words) {
    words = words.slice();

    for (var i = words.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = words[i];
      words[i] = words[j];
      words[j] = temp;
    }

    return words;
  }

  function buildWordTile(word, id, selected) {
    var button = document.createElement("button");

    button.type = "button";
    button.className = "word-tile" + (selected ? " in-answer" : "");
    button.textContent = word;

    button.addEventListener("click", function () {
      speak(word);

      if (selected) {
        state.puzzleAnswer = state.puzzleAnswer.filter(function (item) {
          return item.id !== id;
        });
      } else {
        state.puzzleAnswer.push({ id: id, word: word });
      }

      renderPuzzle();
    });

    return button;
  }

  function renderPuzzle() {
    var bank = byId("wordBank");
    var area = byId("answerArea");

    if (!bank || !area) return;

    var selectedIds = state.puzzleAnswer.map(function (item) {
      return item.id;
    });

    bank.innerHTML = "";
    area.innerHTML = "";

    state.puzzleShuffled.forEach(function (item) {
      if (!selectedIds.includes(item.id)) {
        bank.appendChild(buildWordTile(item.word, item.id, false));
      }
    });

    state.puzzleAnswer.forEach(function (item) {
      area.appendChild(buildWordTile(item.word, item.id, true));
    });

    if (!bank.children.length) {
      bank.innerHTML =
        '<span class="lesson-meta">All words are in the answer area.</span>';
    }

    if (!area.children.length) {
      area.innerHTML =
        '<span class="lesson-meta">Click words in order to build the sentence.</span>';
    }
  }

  function startPuzzle(index) {
    state.activeLesson = index;
    state.puzzleAnswer = [];

    state.puzzleShuffled = shuffleWords(
      lessonText(index).split(/\s+/).filter(Boolean).map(function (word, id) {
        return { id: id, word: word };
      })
    );

    renderPuzzle();
    showScreen("puzzleScreen");
  }

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
      input.setAttribute("aria-label", "Custom lesson " + (index + 1));

      var save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.addEventListener("click", function () {
        window.editLesson(index, input.value);
      });

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete";
      remove.textContent = "Delete";
      remove.addEventListener("click", function () {
        window.deleteLesson(index);
      });

      row.appendChild(input);
      row.appendChild(save);
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function syncLessonAccess() {
    var account = currentAccount();
    if (!account) return;

    var count = allLessons().length;

    account.completedLessons = account.completedLessons.filter(function (i) {
      return i < count;
    });

    account.unlockedLessons = account.unlockedLessons.filter(function (i) {
      return i < count;
    });

    if (!account.unlockedLessons.includes(0)) {
      account.unlockedLessons.push(0);
    }
  }

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

  window.checkTyping = function () {
    var input = byId("typingInput");
    if (!input) return;

    if (normalizeText(input.value) !== normalizeText(lessonText(state.activeLesson))) {
      updateTypingStats();
      input.focus();
      return;
    }

    markLessonComplete(state.activeLesson);
    renderLessonMenu();

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

    var next = state.activeLesson + 1;

    if (next >= allLessons().length) {
      showCompletion(true, "nextLesson", "Next Lesson");
    } else {
      startTyping(next);
    }
  };

  window.checkPuzzle = function () {
    var expected = normalizeText(lessonText(state.activeLesson));
    var answer = normalizeText(
      state.puzzleAnswer.map(function (item) {
        return item.word;
      }).join(" ")
    );

    if (answer !== expected) {
      var area = byId("answerArea");

      if (area && area.animate) {
        area.animate(
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
    renderLessonMenu();

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

    var next = state.activeLesson + 1;

    if (next >= allLessons().length) {
      showCompletion(true, "nextPuzzle", "Keep Going");
    } else {
      startPuzzle(next);
    }
  };

  window.addLesson = function () {
    var input = byId("newLessonText");
    var account = currentAccount();

    if (!input || !account) return;

    var text = normalizeText(input.value);

    if (!text) {
      input.focus();
      return;
    }

    account.customLessons.push(text);
    syncLessonAccess();
    scheduleSave();

    input.value = "";
    renderEditor();
    renderLessonMenu();
  };

  window.editLesson = function (index, value) {
    var account = currentAccount();
    var text = normalizeText(value);

    if (!account || !text || index < 0 || index >= account.customLessons.length) {
      return;
    }

    account.customLessons[index] = text;
    scheduleSave();
    renderEditor();
    renderLessonMenu();
  };

  window.deleteLesson = function (index) {
    var account = currentAccount();

    if (!account || index < 0 || index >= account.customLessons.length) {
      return;
    }

    account.customLessons.splice(index, 1);
    syncLessonAccess();
    scheduleSave();
    renderEditor();
    renderLessonMenu();
  };

  window.setSpeakWords = function (enabled) {
    var account = currentAccount();
    if (!account) return;

    account.settings.speakWords = !!enabled;

    if (isDemo()) demoAccount = account;

    scheduleSave();
  };

  window.setVoiceRate = function (rate) {
    var account = currentAccount();
    if (!account) return;

    var value = Number(rate);
    if (!Number.isFinite(value)) return;

    account.settings.voiceRate = Math.max(0.5, Math.min(2, value));

    if (isDemo()) demoAccount = account;

    scheduleSave();
  };

  function bindSettingsControls() {
    var account = currentAccount();
    var toggle = byId("speakWordsSetting");
    var rate = byId("voiceRateSetting");
    var label = byId("voiceRateValue");

    if (!account) return;

    if (toggle) {
      toggle.checked = account.settings.speakWords !== false;

      if (!toggle.dataset.typeflowBound) {
        toggle.addEventListener("change", function () {
          window.setSpeakWords(toggle.checked);
        });

        toggle.dataset.typeflowBound = "true";
      }
    }

    if (rate) {
      rate.value = String(account.settings.voiceRate || 0.9);

      if (label) {
        label.textContent = Number(rate.value).toFixed(1) + "×";
      }

      if (!rate.dataset.typeflowBound) {
        rate.addEventListener("input", function () {
          window.setVoiceRate(rate.value);

          if (label) {
            label.textContent = Number(rate.value).toFixed(1) + "×";
          }
        });

        rate.dataset.typeflowBound = "true";
      }
    }
  }

  // =========================================================
  // PWA INSTALL + SERVICE WORKER UPDATE CONTROLS
  // =========================================================

  function addPwaSettings() {
    var container = findSettingsContainer();
    if (!container || byId("typeflowPwaSettings")) return;

    var section = document.createElement("section");
    section.id = "typeflowPwaSettings";
    section.style.marginTop = "20px";
    section.style.paddingTop = "16px";
    section.style.borderTop = "1px solid #ddd";

    section.innerHTML =
      "<h3>App</h3>" +
      '<button id="typeflowInstallApp" type="button">Install TypeFlow</button>' +
      '<button id="typeflowCheckUpdate" type="button" style="margin-left:8px">Check for updates</button>' +
      '<p id="typeflowPwaStatus" role="status" aria-live="polite"></p>';

    container.appendChild(section);

    byId("typeflowInstallApp").addEventListener("click", async function () {
      if (!state.deferredInstallPrompt) {
        var status = byId("typeflowPwaStatus");

        if (status) {
          status.textContent =
            "Install may not be available in this browser yet. Try the browser's Install or Add to Dock option.";
        }

        return;
      }

      state.deferredInstallPrompt.prompt();

      try {
        await state.deferredInstallPrompt.userChoice;
      } catch (error) {
        console.warn("TypeFlow install prompt:", error);
      }

      state.deferredInstallPrompt = null;
      updateInstallButton();
    });

    byId("typeflowCheckUpdate").addEventListener("click", async function () {
      var status = byId("typeflowPwaStatus");

      if (!("serviceWorker" in navigator)) {
        if (status) status.textContent = "Service workers aren't supported here.";
        return;
      }

      try {
        if (status) status.textContent = "Checking for updates…";

        var registration = state.serviceWorkerRegistration;

        if (!registration) {
          registration = await navigator.serviceWorker.getRegistration();
        }

        if (!registration) {
          if (status) {
            status.textContent =
              "No service worker was found. Check your index.html setup.";
          }
          return;
        }

        await registration.update();

        if (registration.waiting) {
          if (status) status.textContent = "An update is ready. Reloading…";
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
          return;
        }

        if (status) {
          status.textContent =
            "Update check complete. Reload if a new version was installed.";
        }
      } catch (error) {
        console.error("TypeFlow update check failed:", error);

        if (status) {
          status.textContent = "Couldn't check for updates. Try again later.";
        }
      }
    });

    updateInstallButton();
  }

  function updateInstallButton() {
    var button = byId("typeflowInstallApp");
    if (!button) return;

    if (window.matchMedia &&
        window.matchMedia("(display-mode: standalone)").matches) {
      button.textContent = "TypeFlow is installed";
      button.disabled = true;
    } else {
      button.textContent = state.deferredInstallPrompt
        ? "Install TypeFlow"
        : "Install TypeFlow (if available)";
      button.disabled = false;
    }
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", function () {
    state.deferredInstallPrompt = null;
    updateInstallButton();

    var status = byId("typeflowPwaStatus");
    if (status) status.textContent = "TypeFlow was installed.";
  });

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("./service-worker.js")
      .then(function (registration) {
        state.serviceWorkerRegistration = registration;

        registration.addEventListener("updatefound", function () {
          var worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", function () {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              var status = byId("typeflowPwaStatus");

              if (status) {
                status.textContent =
                  "A TypeFlow update is ready. Use Check for updates to apply it.";
              }
            }
          });
        });
      })
      .catch(function (error) {
        console.warn("TypeFlow service worker registration failed:", error);
      });
  }

  function bindEvents() {
    var input = byId("typingInput");

    if (input) {
      input.addEventListener("input", function () {
        if (!state.typingStartedAt && input.value.length) {
          state.typingStartedAt = Date.now();
        }

        updateTypingStats();

        if (
          normalizeText(input.value) ===
          normalizeText(lessonText(state.activeLesson))
        ) {
          markLessonComplete(state.activeLesson);
          renderLessonMenu();

          showCompletion(
            state.activeLesson >= allLessons().length - 1,
            "nextLesson",
            "Next Lesson"
          );
        }
      });

      input.addEventListener("keyup", function (event) {
        if (event.key === " ") completedWordFromTyping();
      });
    }

    var lessonInput = byId("newLessonText");

    if (lessonInput) {
      lessonInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          window.addLesson();
        }
      });
    }

    var nameInput = byId("displayNameInput");

    if (nameInput) {
      nameInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") window.saveDisplayName();
      });
    }

    bindSettingsControls();
  }

  function init() {
    bindEvents();
    window.showTab("login");
    registerServiceWorker();

    auth.getRedirectResult().catch(function (error) {
      setMessage(authErrorMessage(error), true);
    });

    auth.onAuthStateChanged(async function (user) {
      if (state.demo) return;

      state.currentUser = user;

      if (!user) {
        state.accounts = {};
        state.authReady = true;
        showScreen("authScreen");
        window.showTab("login");
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

