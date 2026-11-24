import {
  DEFAULT_FORM_LANGUAGE,
  type FormLanguage,
} from "@form-forge/form-schema";
import { defaultThemeLabels } from "./theme";

const english = {
  closed: "This form is no longer accepting responses.",
  unavailable: "This form is unavailable.",
  rateLimited: "Too many submissions. Please try again later.",
  retryFailed: "Retry failed. Please try again.",
  poweredBy: "Powered by",
  prefilledAnswer:
    "This link preselected an answer. The value is visible in the URL. You can change the answer.",
  theme: defaultThemeLabels,
  savedResponse: "Saved response",
  incompatible:
    "Saved answers exist for a different published version. They cannot be restored into this version.",
  deleteIncompatible: "Delete incompatible saved answers",
  pending: (date: string) =>
    `Saved answers from ${date}. Resume or discard this saved response before continuing.`,
  resume: "Resume",
  discard: "Discard",
  tabConflict:
    "This saved response changed in another tab. Automatic saving is paused. It may have been discarded or submitted. Your current answers have not been replaced.",
  useSaved: "Use saved answers",
  keepMine: "Keep my answers",
  saveOnDevice: "Save answers on this device",
  savingDescription:
    "Optional. Answers stay in this browser for up to 7 days after the last save. Anyone using this browser profile may access them. They are sent to the server only when you submit.",
  savingChanges: "Saving changes…",
  savedAt: (date: string) => `Saved on this device at ${date}.`,
  savingActive: "Saving is active.",
  savingConfirmation:
    "Only the saved confirmation means a write completed. The last characters may be lost if the browser stops before saving.",
  deleteSaved: "Delete saved answers",
  unknownOutcome:
    "The previous submission outcome is unknown. Retry sends the original answers with the same key, even if you have edited this form.",
  retryOriginal: "Retry original attempt",
  startNew: "Start a new attempt",
  discardWarning:
    "The previous attempt may already have been accepted. Discarding removes its saved retry. Submitting again with a new key could create a second response.",
  confirmDiscard: "Confirm discard",
  cancelDiscard: "Cancel discard",
  newAttemptWarning:
    "The previous attempt may already have been accepted. A new attempt uses a new key and could create a second response. Confirm to use your current answers instead.",
  confirmNew: "Confirm new attempt",
  cancel: "Cancel",
  draftTooLarge: "An oversized saved draft was removed.",
  draftDamaged: "A damaged saved draft was removed.",
  draftUnsupported: "A saved draft used an unsupported format and was removed.",
  draftExpired: "An expired saved draft was removed after seven days.",
  storageError:
    "Local storage is unavailable or full. Your latest changes are not saved. You can turn off saving and continue filling out this form.",
  changedAttempt:
    "Retry the original attempt or explicitly start a new attempt before submitting changed answers.",
  removeError:
    "The saved response could not be removed. Local storage may be unavailable or another tab changed it.",
  invalidAttempt:
    "The saved submission attempt is incompatible with this schema. It was not restored. Discard it to continue.",
  omittedAnswers:
    "Some saved answers were invalid or hidden and were omitted. Review the form before submitting.",
  removedInAnotherTab:
    "The saved response was removed or expired in another tab.",
  discardError:
    "The saved response could not be removed. Local storage may be unavailable or another tab changed it. Choose Use saved answers to inspect the current revision.",
  resolveDraft: "Resolve the saved response before submitting.",
  retryNotSaved:
    "The retry could not be saved. Resolve the storage error before retrying.",
  formChanged:
    "The form changed while preparing the attempt. Please try again.",
  attemptNotSaved:
    "The submission attempt could not be saved. Turn off saving to submit without reload recovery, then try again.",
  submittedCleanupError:
    "Your response was sent, but its local copy could not be removed. Remove saved site data on this device when storage becomes available.",
};

const messages: Record<FormLanguage, typeof english> = {
  en: english,
  ru: {
    closed: "Эта форма больше не принимает ответы.",
    unavailable: "Эта форма недоступна.",
    rateLimited: "Слишком много попыток отправки. Повторите позже.",
    retryFailed: "Не удалось повторить отправку. Попробуйте ещё раз.",
    poweredBy: "Работает на",
    prefilledAnswer:
      "Ответ подставлен из ссылки. Значение видно в URL. Вы можете изменить ответ.",
    theme: {
      group: "Цветовая тема",
      system: "Системная тема",
      light: "Светлая тема",
      dark: "Тёмная тема",
    },
    savedResponse: "Сохранённый ответ",
    incompatible:
      "На этом устройстве сохранены ответы для другой опубликованной версии. Восстановить их здесь нельзя.",
    deleteIncompatible: "Удалить ответы другой версии",
    pending: (date) =>
      `Ответы сохранены ${date}. Восстановите или удалите черновик, чтобы продолжить.`,
    resume: "Восстановить черновик",
    discard: "Удалить черновик",
    tabConflict:
      "Сохранённый ответ изменился в другой вкладке. Возможно, его удалили или отправили. Автоматическое сохранение приостановлено. Введённые здесь ответы пока на месте.",
    useSaved: "Использовать сохранённые ответы",
    keepMine: "Оставить мои ответы",
    saveOnDevice: "Сохранять ответы на этом устройстве",
    savingDescription:
      "По желанию. Ответы хранятся в этом браузере до 7 дней после последнего сохранения. Их может увидеть любой, кто пользуется этим профилем браузера. Ответы попадут на сервер только после отправки формы.",
    savingChanges: "Сохраняем изменения…",
    savedAt: (date) => `Сохранено на этом устройстве ${date}.`,
    savingActive: "Сохранение включено.",
    savingConfirmation:
      "Дождитесь подтверждения сохранения. Если браузер закроется раньше, последние изменения могут потеряться.",
    deleteSaved: "Удалить сохранённые ответы",
    unknownOutcome:
      "Неизвестно, принял ли сервер предыдущий ответ. Повторная отправка использует прежние ответы и тот же ключ, даже если вы успели изменить поля.",
    retryOriginal: "Повторить отправку прежних ответов",
    startNew: "Начать новую попытку",
    discardWarning:
      "Сервер мог уже принять ответ. Если удалить черновик, повторить прежнюю отправку не получится. Отправка с новым ключом может создать второй ответ.",
    confirmDiscard: "Подтвердить удаление",
    cancelDiscard: "Отменить удаление",
    newAttemptWarning:
      "Сервер мог уже принять ответ. Новая попытка использует новый ключ и может создать второй ответ. Подтвердите, чтобы использовать текущие ответы.",
    confirmNew: "Подтвердить новую попытку",
    cancel: "Отмена",
    draftTooLarge: "Слишком большой черновик удалён.",
    draftDamaged: "Повреждённый черновик удалён.",
    draftUnsupported: "Черновик в неподдерживаемом формате удалён.",
    draftExpired: "Черновик удалён по истечении семи дней.",
    storageError:
      "Хранилище браузера недоступно или переполнено. Последние изменения не сохранены. Можно выключить сохранение и продолжить заполнение.",
    changedAttempt:
      "Повторите отправку прежних ответов или начните новую попытку, чтобы отправить изменённые ответы.",
    removeError:
      "Не удалось удалить сохранённый ответ. Возможно, хранилище браузера недоступно или ответ изменился в другой вкладке.",
    invalidAttempt:
      "Сохранённая попытка несовместима с этой версией формы. Удалите черновик, чтобы продолжить.",
    omittedAnswers:
      "Некоторые сохранённые ответы были некорректными или относились к скрытым полям. Проверьте форму перед отправкой.",
    removedInAnotherTab:
      "Черновик удалён в другой вкладке или срок его хранения истёк.",
    discardError:
      "Не удалось удалить сохранённый ответ. Возможно, хранилище браузера недоступно или ответ изменился в другой вкладке. Выберите «Использовать сохранённые ответы», чтобы проверить текущую версию черновика.",
    resolveDraft: "Восстановите или удалите сохранённый ответ перед отправкой.",
    retryNotSaved:
      "Не удалось сохранить попытку. Устраните ошибку хранилища перед повторной отправкой.",
    formChanged:
      "Форма изменилась во время подготовки ответов. Попробуйте ещё раз.",
    attemptNotSaved:
      "Не удалось сохранить попытку отправки. Чтобы отправить форму без восстановления после перезагрузки, выключите сохранение и попробуйте ещё раз.",
    submittedCleanupError:
      "Ответ отправлен. Сохранённую копию удалить не удалось. Очистите данные сайта на этом устройстве, когда хранилище снова станет доступно.",
  },
};

export const getPublicFormMessages = (
  language: FormLanguage = DEFAULT_FORM_LANGUAGE,
) => messages[language];
