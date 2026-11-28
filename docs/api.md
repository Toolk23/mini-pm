# API «мини ПМ» — контракт для фронтенда

Базовый адрес локально: `http://127.0.0.1:8000/api`. На стенде — тот же домен, `/api`.
Все ответы — JSON. Примеры ниже — реальные ответы сервера (сокращены: списки до 2 элементов, длинные строки обрезаны).

## Состояние
`GET /api/health`

Ответ:
```json
{
  "ok": true,
  "data": {
    "metrics_catalog": 16,
    "metrics_data": 3698,
    "releases": 11,
    "backlog": 8,
    "sales": 58,
    "reference_steps": 8
  },
  "llm": {
    "configured": false,
    "provider": "deepseek",
    "model": "deepseek-chat"
  },
  "metrika": {
    "configured": false
  }
}
```

## Сигналы детектора (лента)
`GET /api/signals` — sales_drop — главный кейс KES; series/control_series — точки для графика

Ответ:
```json
[
  {
    "id": "SIG-SALES-KES",
    "kind": "sales_drop",
    "metric_id": "family_orders_idx",
    "product": "Kaspersky Endpoint Security",
    "family": "KES",
    "priority": "Critical",
    "title": "Падение самостоятельных заказов KES: -33.9% к базе",
    "change": {
      "baseline_mean": 165.8,
      "post_mean": 109.7,
      "change_pct": -33.9,
      "baseline_period": "29.06.2026–21.09.2026",
      "post_period": "05.10.2026–09.11.2026",
      "baseline_weeks": 13,
      "post_weeks": 6
    },
    "split_week": "28.09.2026",
    "rolling": {
      "before": 169.5,
      "after_min": 97.8,
      "after_last": 118.2
    },
    "threshold_pct": 20,
    "control": {
      "family": "Astra",
      "name": "Astra Linux Special Edition",
      "baseline_mean": 98.5,
      "post_mean": 101.5,
      "change_pct": 3.0,
      "baseline_period": "29.06.2026–21.09.2026",
      "post_period": "05.10.2026–09.11.2026",
      "baseline_weeks": 13,
      "post_weeks": 6,
      "stable": true,
      "conclusion": "Контроль стабилен — падение специфично для KES"
    },
    "release_candidates": [
      {
        "release_id": "R-07",
        "date": "16.09.2026",
        "type": "major",
        "description": "Новая шапка ЛК с поиском товаров интернет-магазина, каталогом, корзиной и избранным магазина, обновленное боковое меню",
        "affected_metrics": [
          "lk_search_to_store",
          "lk_home_views"
        ],
        "related_task_ids": [
          "T-06"
        ]
      },
      {
        "release_id": "R-08",
        "date": "29.09.2026",
        "type": "infrastructure",
        "description": "Изменен механизм входа на сайт интернет-магазина. С 29.09 по 05.10 терялись источники трафика, с 06.10 визитные показатели несопоставимы с п…",
        "affected_metrics": [
          "cfg_family_views",
          "cfg_reach_rate"
        ],
        "related_task_ids": []
      },
      "…"
    ],
    "caveats": [
      "Неделя 08.06.2026 — разовый всплеск (144.0), исключена из расчёта: это не эффект релиза.",
      "Неделя 28.09.2026 — разовый всплеск (246.0), исключена из расчёта: это не эффект релиза.",
      "…"
    ],
    "series": [
      {
        "week_start": "2026-05-04",
        "value": 62.0,
        "rolling": null,
        "spike": false,
        "incomplete": false,
        "comment": null
      },
      {
        "week_start": "2026-05-11",
        "value": 123.0,
        "rolling": null,
        "spike": false,
        "incomplete": false,
        "comment": null
      },
      "…"
    ],
    "control_series": [
      {
        "week_start": "2026-05-04",
        "value": 42.0,
        "rolling": null,
        "spike": false,
        "incomplete": false,
        "comment": null
      },
      {
        "week_start": "2026-05-11",
        "value": 42.0,
        "rolling": null,
        "spike": false,
        "incomplete": false,
        "comment": null
      },
      "…"
    ]
  },
  {
    "id": "SIG-lk_reco_click_visits-ЛК",
    "kind": "zero_weeks",
    "metric_id": "lk_reco_click_visits",
    "product": "ЛК",
    "priority": "High",
    "title": "lk_reco_click_visits: 5 нед. без событий из 15",
    "facts": {
      "zero_weeks": [
        "17.08.2026",
        "14.09.2026",
        "…"
      ],
      "weeks_total": 15,
      "last_values": [
        0.0,
        2.0,
        "…"
      ]
    },
    "caveats": []
  },
  "…"
]
```

## Ряд метрики + аннотации релизов + разрывы
`GET /api/metrics/{metric_id}/series?product=` — product: «Конфигуратор Kaspersky» | «Конфигуратор Астра» | «ЛК»

Ответ:
```json
{
  "metric_id": "family_orders_idx",
  "product": "Конфигуратор Kaspersky",
  "points": [
    {
      "week_start": "2026-05-04",
      "value": 62.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    {
      "week_start": "2026-05-11",
      "value": 123.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    "…"
  ],
  "annotations": [
    {
      "type": "release",
      "id": "R-01",
      "date": "2026-04-06",
      "label": "R-01 (major)",
      "description": "Конфигуратор Astra Linux: на странице семейства вместо полного списка лицензий пошаговый подбор в отдельном окне",
      "affects_metric": false
    },
    {
      "type": "release",
      "id": "R-02",
      "date": "2026-05-12",
      "label": "R-02 (minor)",
      "description": "Доработки конфигуратора Astra Linux: автопропуск шагов без выбора, цена «от» у вариантов, количество для позиций, которые продаются по неско…",
      "affects_metric": false
    },
    "…"
  ],
  "gaps": [
    {
      "id": "G-01",
      "scope": "family_orders_idx",
      "until": "2026-05-04",
      "text": "Самостоятельные заказы учитываются с 04.05.2026 — раньше данных о продажах нет."
    },
    {
      "id": "G-09",
      "scope": "family_orders_idx",
      "last_week": true,
      "text": "Последняя неделя в листе «Продажи» может быть неполной."
    },
    "…"
  ]
}
```

## Справочник метрик + правила
`GET /api/metrics`

Ответ:
```json
[
  {
    "metric_id": "cfg_family_views",
    "metric_name": "Визиты на страницу семейства",
    "what_it_means": "Сколько визитов включали страницу семейства, на которой стоит конфигуратор. Вход в воронку подбора",
    "formula_or_logic": "Количество визитов, в которых была просмотрена страница семейства",
    "source": "Яндекс Метрика",
    "segment": "семейство (Астра, Kaspersky), устройство",
    "target_value": "Нет плана. База: среднее за 4 недели до релиза",
    "bad_signal": "Падение >20% неделя к неделе",
    "priority_impact": "Medium",
    "comment": "Астра и Kaspersky с 01.02.2026. Визитный показатель: после 29.09.2026 визиты могут дробиться, сравнивать с периодом до 29.09 осторожно",
    "rule": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 20,
      "priority": "Medium"
    }
  },
  {
    "metric_id": "cfg_open",
    "metric_name": "Открытия конфигуратора",
    "what_it_means": "Сколько раз пользователи начали подбор лицензии",
    "formula_or_logic": "Количество событий конфигуратора с типом «открытие»",
    "source": "Яндекс Метрика",
    "segment": "конфигуратор, устройство",
    "target_value": "Нет плана. База: среднее за 4 недели до релиза",
    "bad_signal": "Падение >20% неделя к неделе при неизменных просмотрах страницы семейства",
    "priority_impact": "High",
    "comment": "События конфигуратора есть с 04.06.2026, для Астры более ранних данных нет. У Kaspersky нет события открытия, вместо него считаются визиты с…",
    "rule": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 20,
      "priority": "High"
    }
  },
  "…"
]
```

## Продажи (оба семейства)
`GET /api/sales`

Ответ:
```json
{
  "KES": [
    {
      "week_start": "2026-05-04",
      "value": 62.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    {
      "week_start": "2026-05-11",
      "value": 123.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    "…"
  ],
  "Astra": [
    {
      "week_start": "2026-05-04",
      "value": 42.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    {
      "week_start": "2026-05-11",
      "value": 42.0,
      "rolling": null,
      "spike": false,
      "incomplete": false,
      "comment": null
    },
    "…"
  ]
}
```

## Релизы
`GET /api/releases`

Ответ:
```json
[
  {
    "release_id": "R-01",
    "release_date": "2026-04-06",
    "release_type": "major",
    "description": "Конфигуратор Astra Linux: на странице семейства вместо полного списка лицензий пошаговый подбор в отдельном окне",
    "related_task_ids": [
      "T-01"
    ],
    "affected_metrics": [
      "cfg_family_views"
    ],
    "status": "выпущен"
  },
  {
    "release_id": "R-02",
    "release_date": "2026-05-12",
    "release_type": "minor",
    "description": "Доработки конфигуратора Astra Linux: автопропуск шагов без выбора, цена «от» у вариантов, количество для позиций, которые продаются по неско…",
    "related_task_ids": [
      "T-02"
    ],
    "affected_metrics": [
      "cfg_family_views"
    ],
    "status": "выпущен"
  },
  "…"
]
```

## Реестр разрывов учёта
`GET /api/data-gaps`

Ответ:
```json
[
  {
    "id": "G-01",
    "scope": "family_orders_idx",
    "until": "2026-05-04",
    "text": "Самостоятельные заказы учитываются с 04.05.2026 — раньше данных о продажах нет."
  },
  {
    "id": "G-02",
    "scope": "cfg_*",
    "until": "2026-06-04",
    "text": "События конфигураторов переведены на новую схему 04.06.2026 — события раньше этой даты недоступны."
  },
  "…"
]
```

## Эталонный кейс (8 шагов + ловушки)
`GET /api/reference-case`

Ответ:
```json
{
  "title": "Кейс: падение самостоятельных заказов Kaspersky Endpoint Security после релиза конфигуратора",
  "note": "Причина падения организаторам заранее не известна. Кейс проверяет, как агент находит сигнал, сверяет источники и формулирует проверяемые гип…",
  "steps": [
    {
      "step": "1",
      "what_agent_sees": "Индекс заказов Kaspersky Endpoint Security: среднее недельное значение с 05.10 на треть ниже, чем за 29.06-21.09 (около 112 против 166). Ско…",
      "expected_action": "Зафиксировать отклонение и проверить, что это не шум: смотреть скользящее среднее, а не отдельные недели",
      "expected_result": "Сигнал: устойчивое падение самостоятельных заказов KES примерно на 33%",
      "sheets_used": "Продажи"
    },
    {
      "step": "2",
      "what_agent_sees": "Индекс заказов Astra Linux Special Edition за те же недели почти не изменился (около -3%)",
      "expected_action": "Сравнить с другим семейством той же витрины как с контрольной группой",
      "expected_result": "Падение специфично для KES и не объясняется общей динамикой магазина",
      "sheets_used": "Продажи"
    },
    "…"
  ],
  "traps": [
    "R-08 и R-09 разделяют два дня: без контрольной группы их эффекты легко спутать",
    "Неделя с 28.09 дает разовый всплеск индекса KES перед падением: это не эффект релиза",
    "…"
  ]
}
```

## Запустить расследование
`POST /api/investigations` — фоново; дальше опрашивать GET раз в 2 с, пока status != running

Тело запроса:
```json
{
  "signal_id": "SIG-SALES-KES"
}
```
Ответ:
```json
{
  "id": "INV-XXXXXX",
  "status": "running",
  "signal_id": "SIG-SALES-KES",
  "created_at": "…"
}
```

## Список расследований
`GET /api/investigations`

Ответ:
```json
[]
```

## Применить: задача с тегом + приоритеты + гипотеза + письмо
`POST /api/investigations/{id}/apply` — идемпотентно: повторный вызов вернёт тот же результат

Ответ:
```json
{
  "task": {
    "task_id": "T-09",
    "tags": [
      "сгенерирована ИИ-помощником"
    ]
  },
  "raised": [
    {
      "task_id": "T-08",
      "new_priority": "High"
    }
  ],
  "hypothesis": {
    "id": "H-01"
  },
  "email": {
    "subject": "…",
    "body": "…",
    "eml_path": "state/outbox/INV-….eml",
    "dion": {
      "channel": "Dion · мини ПМ",
      "text": "…"
    }
  }
}
```

## Бэклог
`GET /api/backlog/tasks`

Ответ:
```json
[
  {
    "task_id": "T-01",
    "title": "Конфигуратор для семейства Astra Linux",
    "type": "Фича",
    "status": "Done",
    "priority": "Low",
    "created_date": "2026-01-12",
    "closed_date": "2026-04-06",
    "release_id": [
      "R-01"
    ],
    "description": "На странице семейства невозможно было вывести все 3 000+ позиций, выбрать нужную было очень сложно. Теперь выбор делается в конфигураторе по…",
    "linked_metric_ids": [
      "cfg_family_views"
    ],
    "source": [
      "Исследование",
      "Жалобы"
    ],
    "tags": [],
    "history": []
  },
  {
    "task_id": "T-02",
    "title": "Доработки конфигуратора Astra Linux: шаги, «цена от», кратность",
    "type": "Улучшение",
    "status": "Done",
    "priority": "Medium",
    "created_date": "2026-04-16",
    "closed_date": "2026-05-12",
    "release_id": [
      "R-02"
    ],
    "description": "По итогам демо: пропуск шагов без вариантов выбора, блокировка следующих шагов при смене ответа, цена «от» у каждого варианта, количество в …",
    "linked_metric_ids": [
      "cfg_family_views"
    ],
    "source": [
      "Гипотеза"
    ],
    "tags": [],
    "history": []
  },
  "…"
]
```

## Создать задачу (тег ставит сервер)
`POST /api/backlog/tasks`

Тело запроса:
```json
{
  "title": "…",
  "description": "…",
  "priority": "High",
  "linked_metric_ids": [
    "family_orders_idx"
  ]
}
```
## Изменить задачу
`PATCH /api/backlog/tasks/{task_id}`

Тело запроса:
```json
{
  "status": "In Progress",
  "priority": "High"
}
```
## Экспорт задачи в Redmine
`GET /api/backlog/tasks/{task_id}/redmine`

## Гипотезы
`GET /api/hypotheses`

Ответ:
```json
[]
```

## Замер эффекта (синтетика после хотфикса)
`POST /api/hypotheses/{id}/measure` — verdict: confirmed | rejected; связанная задача → Done | Reopened

Тело запроса:
```json
{
  "scenario": "recovered | not_recovered"
}
```
## Настройки детектора
`GET /api/settings`

Ответ:
```json
{
  "detector": {
    "rolling_window_weeks": 4,
    "baseline_weeks": 13,
    "min_post_weeks": 3,
    "spike_ratio": 1.3,
    "release_window_days": 14,
    "control_max_change_pct": 10
  },
  "sources_weights": {
    "metrika": 0.4,
    "backlog": 0.25,
    "interviews": 0.2,
    "competitors": 0.15
  },
  "metrics": {
    "family_orders_idx": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 20,
      "priority": "Critical"
    },
    "cfg_family_views": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 20,
      "priority": "Medium"
    },
    "cfg_open": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 20,
      "priority": "High"
    },
    "cfg_reach_rate": {
      "enabled": true,
      "rule": "pp_drop",
      "threshold": 5,
      "priority": "High"
    },
    "cfg_completion_rate": {
      "enabled": true,
      "rule": "pp_drop",
      "threshold": 5,
      "priority": "High"
    },
    "cfg_back_reset_rate": {
      "enabled": true,
      "rule": "pct_rise",
      "threshold": 30,
      "priority": "Medium"
    },
    "cfg_add_to_cart_rate": {
      "enabled": true,
      "rule": "pp_drop",
      "threshold": 3,
      "priority": "Critical"
    },
    "lk_home_views": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 30,
      "priority": "Medium"
    },
    "lk_reco_status_visits": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 30,
      "priority": "Medium"
    },
    "lk_reco_shown_share": {
      "enabled": true,
      "rule": "pp_drop",
      "threshold": 10,
      "priority": "High"
    },
    "lk_reco_click_visits": {
      "enabled": true,
      "rule": "zero_week",
      "threshold": 0,
      "priority": "High"
    },
    "lk_reco_ctr": {
      "enabled": true,
      "rule": "pct_drop",
      "threshold": 30,
      "priority": "High"
    }
  }
}
```

## Изменить правило метрики
`PUT /api/settings/metrics/{metric_id}` — после изменения перезапросить /api/signals

Тело запроса:
```json
{
  "threshold": 40,
  "enabled": true
}
```
## Сбросить настройки
`POST /api/settings/reset`

## Поиск по базе знаний
`GET /api/knowledge/search?q=&k=8&source=interview|competitor|upload`

Ответ:
```json
[
  {
    "id": "dd5a79fe8b08",
    "source_type": "interview",
    "file": "E-com ответы нап впоросы по когортам.xlsx",
    "sheet": "Отток",
    "row": 9,
    "title": "E-com ответы нап впоросы по когортам / Отток / респондент 7",
    "text": "[E-com ответы нап впоросы по когортам / Отток] Вопрос: Расскажите про ваш последний заказ в store.softline.ru: что было хорошо и что разочар…",
    "score": 14.812,
    "meta": {
      "study": "E-com ответы нап впоросы по когортам",
      "cohort": "Отток",
      "role": "Начальник отдела ИТО (отвечает за всё внутреннее IT).",
      "respondent_id": "763bf0dec1",
      "kind": "answer",
      "question": "Расскажите про ваш последний заказ в store.softline.ru: что было хорошо и что разочаровало?",
      "question_col": 4,
      "tags": [
        "checkout",
        "payment",
        "…"
      ]
    }
  },
  {
    "id": "937742354140",
    "source_type": "interview",
    "file": "E-com ответы нап впоросы по когортам.xlsx",
    "sheet": "Отток",
    "row": 9,
    "title": "E-com ответы нап впоросы по когортам / Отток / респондент 7",
    "text": "[E-com ответы нап впоросы по когортам / Отток] Вопрос: Опишите идеальный сценарий покупки для вас. Чем он отличается от опыта у нас?\nОтвет: …",
    "score": 12.2051,
    "meta": {
      "study": "E-com ответы нап впоросы по когортам",
      "cohort": "Отток",
      "role": "Начальник отдела ИТО (отвечает за всё внутреннее IT).",
      "respondent_id": "763bf0dec1",
      "kind": "answer",
      "question": "Опишите идеальный сценарий покупки для вас. Чем он отличается от опыта у нас?",
      "question_col": 9,
      "tags": [
        "payment",
        "invoice",
        "…"
      ]
    }
  }
]
```

## Загрузить новое исследование
`POST /api/knowledge/upload` — multipart/form-data, поле file (xlsx/csv/txt/md/docx)

## Чат
`POST /api/chat`

Тело запроса:
```json
{
  "message": "Что клиенты говорят про счета?",
  "history": [
    {
      "role": "user",
      "content": "…"
    },
    {
      "role": "assistant",
      "content": "…"
    }
  ]
}
```
Ответ:
```json
{
  "answer": "…",
  "sources": [
    "…как в knowledge/search"
  ],
  "facts": {
    "signals_detailed": ["…сигналы по упомянутому семейству (или критичные): цифры, контроль, релизы с оценкой, итог расследования"],
    "other_signals": [{"id": "…", "title": "…", "priority": "…"}]
  },
  "mode": "llm | search_only"
}
```
`facts` — какие данные магазина модель видела при ответе (можно показать в UI блоком «На чём основан ответ»).

## Поиск в интернете (Yandex Search API)
`GET /api/web/search?q=купить kaspersky endpoint security&k=5`

Ответ:
```json
{"ok": true, "query": "…", "source": "Yandex Search API",
 "results": [{"url": "…", "domain": "…", "title": "…", "snippet": "…"}]}
```
Без ключа: `{"ok": false, "results": [], "error": "Yandex Search API не настроен …"}`. В `/api/health` — `web_search.configured`.
Результаты также попадают в отчёт расследования (`evidence.web`) и в чат (`facts.web`, если в вопросе «поищи в интернете», «конкуренты», «рынок» и т.п.).
Сводка аналитика по внешним источникам — `evidence.analyst_evidence`.
Её точные цитаты идут первыми в `evidence.interviews` / `evidence.competitors` (тот же формат фрагмента плюс `curated: true`,
`finding` — вывод аналитика, `supports_hypothesis`) и в `steps[n=6].quotes` отчёта.

Тег задачи «изменена ИИ-помощником» ставится только при изменениях от агента (курьер поднял приоритет, замер закрыл задачу).
`PATCH /api/backlog/tasks/{id}` от человека тег не ставит; в `history[].by` — `pm` или `ai`.

## Почта (отправка на тестовый ящик)
При `POST /api/investigations/{id}/apply` письмо ПМу сохраняется в `outbox/*.eml` и, если настроен SMTP
(`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_TO`), отправляется. В ответе `email.sent`: `{"ok": true, "to": "…", "at": "…"}`
или `{"ok": false, "error": "…"}`. `email.to` — адресат.
- `POST /api/investigations/{id}/send-email` — отправить ещё раз;
- `POST /api/sales-briefs/{id}/send` — разослать справку отделу продаж;
- `GET /api/mail/log` — журнал отправленных писем; в `/api/health` — `mail.configured`, `mail.to`.

## Экспорт бэклога в Redmine
- `GET /api/backlog/tasks/{id}/redmine` — JSON для `POST /issues.json` (Redmine REST API);
- `GET /api/backlog/redmine.csv?ai_only=true` — CSV (`;`, UTF-8) для импорта задач в Redmine; `ai_only` — только задачи агента.

## Живая карточка товара (store.softline.ru)
`GET /api/storefront/card?family=KES` → `{"ok": true, "url": "…", "title": "…", "prices_rub": [23220], "excerpt": "текст карточки",
"issues": ["В HTML карточки скрытый текст-заглушка «Lorem ipsum» под ценой (покупателю не виден)"], "fetched_at": "…"}`.
Публичная страница, без входа. Справка для продаж берёт из неё редакции, сроки и цену (`evidence.store_card`),
проблемы карточки — в `internal_note`.

## Справка для отдела продаж
Бизнес-проблема задачи — ПМ тратит часы на одни и те же объяснения продавцам. Агент собирает шпаргалку по продукту
из конкурентного анализа, интервью, сводки аналитика, сигналов, релизов и поиска Яндекса; каждый тезис со ссылкой на источник.

`POST /api/sales-briefs` `{"product": "KES"}` — синхронно, ~30–50 с с LLM (без ключа — шаблон из цитат аналитика). Ответ:
```json
{"id": "SB-1A2B3C", "created_at": "…", "mode": "llm", "family": "KES", "tag": "сгенерирована ИИ-помощником",
 "product": "Kaspersky Endpoint Security для бизнеса",
 "pitch": "2–3 предложения для клиента",
 "who_buys": ["…"],
 "key_points": [{"text": "…", "source": "E-01 | <id фрагмента> | URL"}],
 "vs_competitors": [{"competitor": "allsoft.ru", "point": "…", "source": "…"}],
 "faq": [{"q": "…", "a": "…", "source": "…"}],
 "objections": [{"objection": "…", "answer": "…", "source": "…"}],
 "dont_say": ["чего нельзя обещать — нет данных"],
 "internal_note": "для ПМа: сигналы и релизы по продукту",
 "message": "сообщение в канал продаж (Dion)",
 "video_script": [{"sec": "0–10", "screen": "что показать на карточке товара", "voice": "текст для озвучки"}],
 "evidence": {"analyst_quotes": [], "competitors": [], "interviews": [], "signals": [], "releases": [], "web": []}}
```
`product` — `KES`, `Astra` или любое название (поиск по базе знаний).
`GET /api/sales-faq?family=KES` — типовые вопросы с ответами от аналитика (`data/curated/sales_faq.json`, как есть);
они же идут в справку (`evidence.analyst_faq`) и в чат (`facts.analyst_faq`).
Сводка аналитика по Astra — `data/curated/evidence_astra.json` (тот же формат, что по Kaspersky) — подхватывается автоматически.
`GET /api/sales-briefs` — список (без `evidence`), `GET /api/sales-briefs/{id}` — целиком.
Чат подхватывает последнюю справку по упомянутому продукту (`facts.sales_brief`) — типовые вопросы отвечаются по ней.
Токены — шаг `sales_brief` в `/api/usage/tokens`.

## Живой счётчик Яндекс.Метрики
`GET /api/metrika/live?date1=7daysAgo&date2=today`

Ответ:
```json
{
  "ok": false,
  "error": "METRIKA_TOKEN / METRIKA_COUNTER_ID не заданы",
  "source": "metrika"
}
```

## Токены по шагам (для калькулятора)
`GET /api/usage/tokens`

Ответ:
```json
{
  "steps": {},
  "records": 0
}
```
