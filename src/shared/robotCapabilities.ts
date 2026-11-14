/** Real native handlers plus the control activities implemented by the package runner. */
export const robotActivities = new Set([
  'create-human-task', 'wait-for-human-task',
  'transaction-scope', 'business-rule-exception',
  'use-app-browser','open-browser','close-browser','navigate-to','navigate-back','navigate-forward','refresh-page',
  'open-new-tab','close-tab','switch-tab','switch-frame','switch-default-content','accept-alert','dismiss-alert','maximize-window','execute-javascript',
  'click','double-click','right-click','hover','type-into','clear-text','send-hotkey','select-option','check-checkbox','drag-drop','scroll-to','scroll-page','upload-file','focus-element','take-screenshot',
  'get-text','get-attribute','get-value','get-inner-html','get-element-count','get-page-title','get-page-url','get-all-text','extract-table','find-elements',
  'wait-element','wait-element-vanish','wait-page-load','wait-text','element-exists','assert-text','assert-title','assert-url',
  'write-line','log-message','delay','run-script-file','run-script-code','assign','throw','create-folder','get-files','copy-file','move-file','delete-file','read-file','write-file','read-csv','write-csv','read-pdf','ocr-image','ocr-pdf',
  'connect-m365','outlook-send-email','outlook-get-emails','onedrive-upload-file','onedrive-download-file','m365-graph-request','http-request','json-deserialize',
  'add-queue-item','get-transaction-item','set-transaction-status',
  'get-asset','get-credential',
  'invoke-workflow','sequence','if','for-each','try-catch','retry-scope','break','continue','create-list','add-to-collection','remove-from-collection','clear-collection',
]);
