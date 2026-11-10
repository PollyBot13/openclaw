# Input-only follow-up: capture baseline did not qualify

Follow-up to the evidence at `8355ee1654c79e16641b43e579b33fa12f83611d`, still based on draft head `023ef9b66c1e34a5be8d7e0b5f97908f4be4c1a9`. Live Chromium evidence only, not physical Safari.

Prepared right-side mode using an inner footer locator click (setup only), then one upward scroll command in the outer gutter at (1260,580). After setup there were no clicks, focus changes, keyboard actions, deliberate layout changes, scroll assignments, or gesture input during the following bracketed captures. Probes were read-only. Intermediate sandbox offsets were included through its ordinary frame locator.

The baseline before the first crop was outer scrollTop 22/max 742 (720 remaining), inner 1255/max 1255 (zero remaining), feed 0. After that crop it was outer 369/max 742, inner 210/max 1255, feed 0. Viewport remained 1280×720. This is an unmatched sample; it cannot establish a product snap-back, successful gesture, or routing failure.

Two consecutive read-only checks at 18:38:14.918Z and 18:38:15.018Z retained outer 369 and inner 210. A second no-input capture retained those offsets but changed the measured board bounds from x800/y86/480×634 to x0/y456.32/1280×177.68, while the top viewport still reported 1280×720. The outer maximum consequently changed. This second capture is also unmatched.

Because the prerequisite baseline did not remain stable through capture, the requested widget-versus-gutter input comparison was not run or claimed. Capture/coordinate reconciliation is now the immediate blocker for that comparison. Possible causes include capture behavior, asynchronous layout/restoration, or other session interactions; none was established. Per-capture UTC timestamps and all relevant geometry are below. No more identical attempts were made. No product code or shared widget changes. The initial evidence remains geometry evidence only.

```json
{
  "startedAt": "2026-11-10T18:38:00.491Z",
  "boundary": "Live in-app Chromium, no physical touch. After setup, scroll input and read-only probes/captures only.",
  "noInputReads": [
    {
      "at": "2026-11-10T18:38:14.918Z",
      "viewport": {
        "height": 720,
        "visualHeight": 720,
        "width": 1280
      },
      "board": {
        "bottom": 720,
        "className": "",
        "clientHeight": 634,
        "display": "block",
        "gridTemplateRows": "none",
        "height": 634,
        "left": 800,
        "overflowY": "auto",
        "overscrollBehaviorY": "auto",
        "remaining": 373,
        "scrollHeight": 1376,
        "scrollTop": 369,
        "tag": "openclaw-board-view",
        "top": 86,
        "touchAction": "auto",
        "width": 480
      },
      "frame": {
        "bottom": 1076,
        "className": "board-widget__frame",
        "clientHeight": 1346,
        "display": "block",
        "gridTemplateRows": "none",
        "height": 1346,
        "left": 817,
        "overflowY": "clip",
        "overscrollBehaviorY": "auto",
        "remaining": 0,
        "scrollHeight": 1346,
        "scrollTop": 0,
        "tag": "iframe",
        "top": -270,
        "touchAction": "auto",
        "width": 434
      },
      "inner": {
        "body": {
          "bottom": 2391.046875,
          "clientHeight": 2601,
          "height": 2601.046875,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 2601,
          "scrollTop": 0,
          "tag": "body",
          "top": -210,
          "touchAction": "auto"
        },
        "footer": {
          "bottom": 2369.046875,
          "clientHeight": 77,
          "height": 77,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 77,
          "scrollTop": 0,
          "tag": "footer",
          "top": 2292.046875,
          "touchAction": "auto"
        },
        "nested": [
          {
            "bottom": 1735.046875,
            "clientHeight": 475,
            "height": 475,
            "overflowY": "auto",
            "overscrollBehaviorY": "auto",
            "remaining": 3923,
            "scrollHeight": 4398,
            "scrollTop": 0,
            "tag": "div",
            "top": 1260.046875,
            "touchAction": "auto"
          }
        ],
        "root": {
          "bottom": 2391.046875,
          "clientHeight": 1346,
          "height": 2601.046875,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 1045,
          "scrollHeight": 2601,
          "scrollTop": 210,
          "tag": "html",
          "top": -210,
          "touchAction": "auto"
        },
        "viewport": {
          "height": 1346,
          "width": 434
        }
      }
    },
    {
      "at": "2026-11-10T18:38:15.018Z",
      "viewport": {
        "height": 720,
        "visualHeight": 720,
        "width": 1280
      },
      "board": {
        "bottom": 720,
        "className": "",
        "clientHeight": 634,
        "display": "block",
        "gridTemplateRows": "none",
        "height": 634,
        "left": 800,
        "overflowY": "auto",
        "overscrollBehaviorY": "auto",
        "remaining": 373,
        "scrollHeight": 1376,
        "scrollTop": 369,
        "tag": "openclaw-board-view",
        "top": 86,
        "touchAction": "auto",
        "width": 480
      },
      "frame": {
        "bottom": 1076,
        "className": "board-widget__frame",
        "clientHeight": 1346,
        "display": "block",
        "gridTemplateRows": "none",
        "height": 1346,
        "left": 817,
        "overflowY": "clip",
        "overscrollBehaviorY": "auto",
        "remaining": 0,
        "scrollHeight": 1346,
        "scrollTop": 0,
        "tag": "iframe",
        "top": -270,
        "touchAction": "auto",
        "width": 434
      },
      "inner": {
        "body": {
          "bottom": 2391.046875,
          "clientHeight": 2601,
          "height": 2601.046875,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 2601,
          "scrollTop": 0,
          "tag": "body",
          "top": -210,
          "touchAction": "auto"
        },
        "footer": {
          "bottom": 2369.046875,
          "clientHeight": 77,
          "height": 77,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 77,
          "scrollTop": 0,
          "tag": "footer",
          "top": 2292.046875,
          "touchAction": "auto"
        },
        "nested": [
          {
            "bottom": 1735.046875,
            "clientHeight": 475,
            "height": 475,
            "overflowY": "auto",
            "overscrollBehaviorY": "auto",
            "remaining": 3923,
            "scrollHeight": 4398,
            "scrollTop": 0,
            "tag": "div",
            "top": 1260.046875,
            "touchAction": "auto"
          }
        ],
        "root": {
          "bottom": 2391.046875,
          "clientHeight": 1346,
          "height": 2601.046875,
          "overflowY": "visible",
          "overscrollBehaviorY": "auto",
          "remaining": 1045,
          "scrollHeight": 2601,
          "scrollTop": 210,
          "tag": "html",
          "top": -210,
          "touchAction": "auto"
        },
        "viewport": {
          "height": 1346,
          "width": 434
        }
      }
    }
  ],
  "captures": [
    {
      "label": "routing-baseline",
      "screenshotAt": "2026-11-10T18:38:00.655Z",
      "before": {
        "at": "2026-11-10T18:38:00.493Z",
        "viewport": {
          "height": 720,
          "visualHeight": 720,
          "width": 1280
        },
        "layout": "sidebar-region sidebar-region--right sidebar-region--background sidebar-region--open sidebar-region--desktop sidebar-region--external-toggle sidebar-region--side-visible",
        "board": {
          "bottom": 720,
          "className": "",
          "clientHeight": 634,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 634,
          "left": 800,
          "overflowY": "auto",
          "overscrollBehaviorY": "auto",
          "remaining": 720,
          "scrollHeight": 1376,
          "scrollTop": 22,
          "tag": "openclaw-board-view",
          "top": 86,
          "touchAction": "auto",
          "width": 480
        },
        "frame": {
          "bottom": 1423,
          "className": "board-widget__frame",
          "clientHeight": 1346,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 1346,
          "left": 817,
          "overflowY": "clip",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 1346,
          "scrollTop": 0,
          "tag": "iframe",
          "top": 77,
          "touchAction": "auto",
          "width": 434
        },
        "inner": {
          "body": {
            "bottom": 1346.046875,
            "clientHeight": 2601,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 2601,
            "scrollTop": 0,
            "tag": "body",
            "top": -1255,
            "touchAction": "auto"
          },
          "footer": {
            "bottom": 1324.046875,
            "clientHeight": 77,
            "height": 77,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 77,
            "scrollTop": 0,
            "tag": "footer",
            "top": 1247.046875,
            "touchAction": "auto"
          },
          "nested": [
            {
              "bottom": 690.046875,
              "clientHeight": 475,
              "height": 475,
              "overflowY": "auto",
              "overscrollBehaviorY": "auto",
              "remaining": 3923,
              "scrollHeight": 4398,
              "scrollTop": 0,
              "tag": "div",
              "top": 215.046875,
              "touchAction": "auto"
            }
          ],
          "root": {
            "bottom": 1346.046875,
            "clientHeight": 1346,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 2601,
            "scrollTop": 1255,
            "tag": "html",
            "top": -1255,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        },
        "sandbox": {
          "body": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "body",
            "top": 0,
            "touchAction": "auto"
          },
          "footer": null,
          "nested": [],
          "root": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "html",
            "top": 0,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        }
      },
      "after": {
        "at": "2026-11-10T18:38:01.004Z",
        "viewport": {
          "height": 720,
          "visualHeight": 720,
          "width": 1280
        },
        "layout": "sidebar-region sidebar-region--right sidebar-region--background sidebar-region--open sidebar-region--side-visible sidebar-region--desktop sidebar-region--external-toggle",
        "board": {
          "bottom": 720,
          "className": "",
          "clientHeight": 634,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 634,
          "left": 800,
          "overflowY": "auto",
          "overscrollBehaviorY": "auto",
          "remaining": 373,
          "scrollHeight": 1376,
          "scrollTop": 369,
          "tag": "openclaw-board-view",
          "top": 86,
          "touchAction": "auto",
          "width": 480
        },
        "frame": {
          "bottom": 1076,
          "className": "board-widget__frame",
          "clientHeight": 1346,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 1346,
          "left": 817,
          "overflowY": "clip",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 1346,
          "scrollTop": 0,
          "tag": "iframe",
          "top": -270,
          "touchAction": "auto",
          "width": 434
        },
        "inner": {
          "body": {
            "bottom": 2391.046875,
            "clientHeight": 2601,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 2601,
            "scrollTop": 0,
            "tag": "body",
            "top": -210,
            "touchAction": "auto"
          },
          "footer": {
            "bottom": 2369.046875,
            "clientHeight": 77,
            "height": 77,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 77,
            "scrollTop": 0,
            "tag": "footer",
            "top": 2292.046875,
            "touchAction": "auto"
          },
          "nested": [
            {
              "bottom": 1735.046875,
              "clientHeight": 475,
              "height": 475,
              "overflowY": "auto",
              "overscrollBehaviorY": "auto",
              "remaining": 3923,
              "scrollHeight": 4398,
              "scrollTop": 0,
              "tag": "div",
              "top": 1260.046875,
              "touchAction": "auto"
            }
          ],
          "root": {
            "bottom": 2391.046875,
            "clientHeight": 1346,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 1045,
            "scrollHeight": 2601,
            "scrollTop": 210,
            "tag": "html",
            "top": -210,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        },
        "sandbox": {
          "body": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "body",
            "top": 0,
            "touchAction": "auto"
          },
          "footer": null,
          "nested": [],
          "root": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "html",
            "top": 0,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        }
      }
    },
    {
      "label": "routing-no-input-repeat",
      "screenshotAt": "2026-11-10T18:38:15.137Z",
      "before": {
        "at": "2026-11-10T18:38:15.071Z",
        "viewport": {
          "height": 720,
          "visualHeight": 720,
          "width": 1280
        },
        "layout": "sidebar-region sidebar-region--right sidebar-region--background sidebar-region--open sidebar-region--side-visible sidebar-region--desktop sidebar-region--external-toggle",
        "board": {
          "bottom": 720,
          "className": "",
          "clientHeight": 634,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 634,
          "left": 800,
          "overflowY": "auto",
          "overscrollBehaviorY": "auto",
          "remaining": 373,
          "scrollHeight": 1376,
          "scrollTop": 369,
          "tag": "openclaw-board-view",
          "top": 86,
          "touchAction": "auto",
          "width": 480
        },
        "frame": {
          "bottom": 1076,
          "className": "board-widget__frame",
          "clientHeight": 1346,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 1346,
          "left": 817,
          "overflowY": "clip",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 1346,
          "scrollTop": 0,
          "tag": "iframe",
          "top": -270,
          "touchAction": "auto",
          "width": 434
        },
        "inner": {
          "body": {
            "bottom": 2391.046875,
            "clientHeight": 2601,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 2601,
            "scrollTop": 0,
            "tag": "body",
            "top": -210,
            "touchAction": "auto"
          },
          "footer": {
            "bottom": 2369.046875,
            "clientHeight": 77,
            "height": 77,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 77,
            "scrollTop": 0,
            "tag": "footer",
            "top": 2292.046875,
            "touchAction": "auto"
          },
          "nested": [
            {
              "bottom": 1735.046875,
              "clientHeight": 475,
              "height": 475,
              "overflowY": "auto",
              "overscrollBehaviorY": "auto",
              "remaining": 3923,
              "scrollHeight": 4398,
              "scrollTop": 0,
              "tag": "div",
              "top": 1260.046875,
              "touchAction": "auto"
            }
          ],
          "root": {
            "bottom": 2391.046875,
            "clientHeight": 1346,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 1045,
            "scrollHeight": 2601,
            "scrollTop": 210,
            "tag": "html",
            "top": -210,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        },
        "sandbox": {
          "body": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "body",
            "top": 0,
            "touchAction": "auto"
          },
          "footer": null,
          "nested": [],
          "root": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "html",
            "top": 0,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        }
      },
      "after": {
        "at": "2026-11-10T18:38:15.530Z",
        "viewport": {
          "height": 720,
          "visualHeight": 720,
          "width": 1280
        },
        "layout": "sidebar-region sidebar-region--right sidebar-region--background sidebar-region--open sidebar-region--side-visible sidebar-region--mobile-host sidebar-region--narrow",
        "board": {
          "bottom": 634,
          "className": "",
          "clientHeight": 178,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 177.6796875,
          "left": 0,
          "overflowY": "auto",
          "overscrollBehaviorY": "auto",
          "remaining": 829,
          "scrollHeight": 1376,
          "scrollTop": 369,
          "tag": "openclaw-board-view",
          "top": 456.3203125,
          "touchAction": "auto",
          "width": 1280
        },
        "frame": {
          "bottom": 1446.3203125,
          "className": "board-widget__frame",
          "clientHeight": 1346,
          "display": "block",
          "gridTemplateRows": "none",
          "height": 1346,
          "left": 17,
          "overflowY": "clip",
          "overscrollBehaviorY": "auto",
          "remaining": 0,
          "scrollHeight": 1346,
          "scrollTop": 0,
          "tag": "iframe",
          "top": 100.3203125,
          "touchAction": "auto",
          "width": 1236
        },
        "inner": {
          "body": {
            "bottom": 2391.046875,
            "clientHeight": 2601,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 2601,
            "scrollTop": 0,
            "tag": "body",
            "top": -210,
            "touchAction": "auto"
          },
          "footer": {
            "bottom": 2369.046875,
            "clientHeight": 77,
            "height": 77,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 77,
            "scrollTop": 0,
            "tag": "footer",
            "top": 2292.046875,
            "touchAction": "auto"
          },
          "nested": [
            {
              "bottom": 1735.046875,
              "clientHeight": 475,
              "height": 475,
              "overflowY": "auto",
              "overscrollBehaviorY": "auto",
              "remaining": 3923,
              "scrollHeight": 4398,
              "scrollTop": 0,
              "tag": "div",
              "top": 1260.046875,
              "touchAction": "auto"
            }
          ],
          "root": {
            "bottom": 2391.046875,
            "clientHeight": 1346,
            "height": 2601.046875,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 1045,
            "scrollHeight": 2601,
            "scrollTop": 210,
            "tag": "html",
            "top": -210,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        },
        "sandbox": {
          "body": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "body",
            "top": 0,
            "touchAction": "auto"
          },
          "footer": null,
          "nested": [],
          "root": {
            "bottom": 1346,
            "clientHeight": 1346,
            "height": 1346,
            "overflowY": "visible",
            "overscrollBehaviorY": "auto",
            "remaining": 0,
            "scrollHeight": 1346,
            "scrollTop": 0,
            "tag": "html",
            "top": 0,
            "touchAction": "auto"
          },
          "viewport": {
            "height": 1346,
            "width": 434
          }
        }
      }
    }
  ]
}
```

