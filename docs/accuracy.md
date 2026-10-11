# Precisión del análisis / Analysis accuracy

Registro de la precisión de cada versión del algoritmo (SPEC §5). Los valores de referencia
para detectar retrocesos están en [`accuracy.json`](accuracy.json): `tools.eval_key --check`
y `tools.eval_tempo --check` fallan si la métrica baja más de 2 puntos.

Los datasets se descargan con `uv run python -m tools.fetch_datasets key tempo mtg-key` a
`datasets/` (ignorada por git). El audio tiene copyright: solo se usa en local y nunca se sube
al repositorio.

| Dataset | Uso | Pistas |
|---|---|---|
| GiantSteps Key | **test** de tonalidad (nunca se entrena ni se ajusta con él) | 599 de 604 (5 sin audio en la copia de Zenodo) |
| GiantSteps-MTG-Key | **entrenamiento** de los perfiles aprendidos (confianza 2) | 1 156 |
| GiantSteps Tempo | test de tempo (anotaciones originales y v2 de Schreiber) | 664 |

## Resultados — `analysis_version` 2.2 (2026-10-11)

### Tonalidad — GiantSteps Key

| Método | Exacta | MIREX |
|---|---|---|
| Ensemble de perfiles publicados (edma, bgate, temperley, krumhansl) — v2.0 | 0,367 | 0,492 |
| Mejor perfil publicado solo (bgate, HPCP 25–3500 Hz) — experimento | — | 0,61 |
| **Perfiles aprendidos en GiantSteps-MTG-Key — v2.2** | **0,644** | **0,722** |

Objetivo de la fase 2: **MIREX ≥ 0,75 → no alcanzado (0,722).**

Categorías (v2.2): 386 correctas, 55 quinta, 43 relativa, 30 paralela, 85 otras.
Validación cruzada (5 particiones) en el conjunto de entrenamiento: MIREX 0,703.
Tiempo: 0,18 s por extracto de 2 min (9 procesos).

### Tempo — GiantSteps Tempo (rango 70–180 BPM)

| Anotaciones | Género | Accuracy1 | Accuracy2 |
|---|---|---|---|
| v2 (corregidas) | sí | **0,889** | 0,971 |
| originales | sí | 0,818 | 0,904 |
| v2 | no | 0,782 | 0,967 |
| originales | no | 0,693 | 0,899 |
| v2 — algoritmo v2.0 | no | 0,625 | 0,786 |

Objetivo de la fase 2: **Accuracy1 ≥ 0,85 → alcanzado con las anotaciones v2 y el género**
(0,889). Con las anotaciones originales, que contienen errores conocidos que la v2 corrige, se
queda en 0,818.

"Género" significa que el prior de tempo se centra en el tempo típico del género, como hace la
app con la etiqueta de género de cada archivo (SPEC 2.4: mitad/doble según el género). En la
evaluación se usa el género de Beatport que incluye el dataset. Sin género, el prior se centra
en 125 BPM.

Tempo variable: con el algoritmo v2.0 se marcaba el 84 % de los temas (todos son de tempo
constante); con v2.2, el 3,5 %.

## Qué cambió y por qué

**Tonalidad (v2.2).** Con un HPCP propio (numpy/scipy, sin Essentia) los perfiles publicados se
estancan en ~0,60: confunden sobre todo menor con su paralela mayor (Am → A). Se probaron
variantes del HPCP (armónicos, ponderación, rango de frecuencias, blanqueado espectral, umbral de
picos, con y sin HPSS): el mayor salto fue incluir los graves (25 Hz) y usar todas las tramas no
silenciosas. Después se sustituyó el ensemble por perfiles aprendidos: un modelo lineal invariante
a la transposición (2 modos × 7 canales × 12 notas: HPCP en 4 bandas, histograma de la nota del
bajo, histograma de la nota dominante y croma RMS), entrenado con regresión logística (softmax de
24 tonalidades) en GiantSteps-MTG-Key. La configuración se eligió solo con validación cruzada en
ese conjunto. También se probaron una red pequeña (MLP) y clasificar ventanas de 3 s: no mejoraron.
El ensemble de perfiles publicados se mantiene como alternativa si falta `key_model.json`.

**Tempo (v2.2).** La saliencia suma la autocorrelación a media pulsación, 1, 2, 4 y 8 pulsaciones
(los compases separan el pulso de sus vecinos 4/3 y 2/3); el prior se centra en el tempo típico
del género; un peine sobre toda la envolvente de ataques afina el BPM (0,01 %) y la fase, de modo
que la rejilla no se desplaza a lo largo del tema; y el tempo variable se decide comparando el
tempo de cada tercio del tema.

## Cómo reproducir

```
cd engine
uv run python -m tools.fetch_datasets key tempo mtg-key
uv run python -m tools.train_key                  # vuelve a generar key_model.json
uv run python -m tools.eval_key --giantsteps
uv run python -m tools.eval_tempo --giantsteps --v2
uv run python -m tools.eval_tempo --giantsteps    # anotaciones originales
uv run python -m tools.eval_key --tags ~/Música   # con las etiquetas de tu propia biblioteca
```
