# Precisión del análisis / Analysis accuracy

Registro de la precisión de cada versión del algoritmo (SPEC §5). Los valores de referencia
para detectar retrocesos están en [`accuracy.json`](accuracy.json): `tools.eval_key --check`
y `tools.eval_tempo --check` fallan si la métrica baja más de 2 puntos.

Los datasets se descargan con `uv run python -m tools.fetch_datasets key tempo mtg-key` a
`datasets/` (ignorada por git). El audio tiene copyright: solo se usa en local y nunca se sube
al repositorio.

| Dataset | Uso | Pistas |
|---|---|---|
| GiantSteps Key | **test** de tonalidad y de presencia de voz (nunca se entrena ni se ajusta con él) | 599 de 604 (5 sin audio en la copia de Zenodo) |
| GiantSteps-MTG-Key | **entrenamiento** de los perfiles aprendidos y de la red de tonalidad (confianza 2) y del modelo de voz (900 previews, 40 s centrales) | 1 156 |
| GiantSteps Tempo | test de tempo (anotaciones originales y v2 de Schreiber) | 664 |

## Resultados — `analysis_version` 2.10 (2026-10-15): presencia de voz sin stems (SPEC 12.3)

Referencia: la proporción de voz **medida** en las stems de Demucs (`htdemucs`) en las secciones
principales del tema. Error medio absoluto (MAE, en una escala de 0 a 1) de la estimación hecha
solo con la mezcla:

| Conjunto | Temas | Heurística anterior | Valor constante | **Modelo — v2.10** |
|---|---|---|---|---|
| GiantSteps Key (previews, nunca entrenado) | 600 | 0,157 | 0,133 | **0,062** |
| Temas completos del autor (validación cruzada, 3 particiones) | 33 | 0,092 | 0,078 | **0,055** |
| GiantSteps-MTG-Key (validación cruzada, 5 particiones) | 900 | 0,155 | 0,126 | **0,075** |

Objetivo de la tarea 12.3: **MAE ≤ 0,05 → no alcanzado** (0,055 en temas completos y 0,062 en
previews), pero el modelo reduce el error de la heurística a menos de la mitad en las previews y
en un 40 % en temas completos. Correlación con la medida: 0,85 (previews).

Acapella / instrumental / tema con voz (umbrales 0,11 y 0,82, ajustados en el entrenamiento):

| Conjunto | Acierto | Acapella | Instrumental | Con voz |
|---|---|---|---|---|
| GiantSteps Key (cada tema da su mezcla, su voz sola y su instrumental) | 0,867 | 0,987 | 0,798 | 0,833 |
| Temas completos del autor (modelo sin ellos en el entrenamiento) | 0,980 | 1,000 | 0,943 | 1,000 |

Objetivo ≥ 90 %: **alcanzado en temas completos, no en las previews de 2 min** (sobre todo
instrumentales de electrónica con melodías que el modelo confunde con voz). Coste: 0,26 s por tema
de 6 min (la heurística tardaba 1,05 s).

**El modelo.** `analysis/vocals.py`: espectrograma log-mel de 40 bandas (80–5 000 Hz, 11 025 Hz,
sin el nivel medio del tema), tres convoluciones 3×3 de 32 canales con *max-pooling* en
frecuencia, una convolución temporal (9×1) y una cabeza que da, para cada trama, la parte de su
potencia que es voz; la presencia del tema agrega esas partes ponderadas por potencia en las
secciones principales, como la medida con stems. Se entrena con `tools/train_vocals.py`
(PyTorch, solo en local) sobre las stems de Demucs: cada tema da tres ejemplos (la mezcla, la voz
sola como acapella y el resto como instrumental), así que no hay etiquetas manuales. Se ejecuta en
numpy (`vocals_model.npz`, 106 KB). Si falta, la app vuelve a la heurística.

Experimentos (MAE con validación cruzada):

| Variante | Previews | Temas completos |
|---|---|---|
| Red densa por trama (sin contexto temporal) | 0,166 | — |
| CNN de 16 canales | 0,083 | — |
| **CNN de 32 canales** | **0,075** | 0,095 (solo previews en el entrenamiento) |
| 32 canales, 120 épocas, más peso al agregado | 0,080 | — |
| 32 canales, fragmentos de 24 s | 0,082 | — |
| + temas completos ×5 en el entrenamiento | 0,063 | 0,061 |
| **+ temas completos ×15** | **0,062** | **0,055** |
| + temas completos ×30 | 0,063 | 0,054 |

## Resultados — `analysis_version` 2.9 (2026-10-15): red de tonalidad (SPEC 12.1)

### Tonalidad — GiantSteps Key

| Método | Exacta | MIREX |
|---|---|---|
| Perfiles aprendidos — v2.2 | 0,644 | 0,722 |
| **Perfiles aprendidos + red convolucional — v2.9** | **0,679** | **0,743** |

Objetivo de la tarea 12.1: **MIREX ≥ 0,80 → no alcanzado (0,743).** Sin retroceso en
GiantSteps-MTG-Key: la validación cruzada (5 particiones) pasa de 0,703 a 0,750.

Categorías (v2.9): 407 correctas, 40 quinta, 41 relativa, 28 paralela, 83 otras.
Tiempo: 0,21 s por extracto de 2 min (9 procesos); la red suma ~0,3 s a un tema de 6 min en un M4 (sin medir en un M1; el límite es 1 s).

**La red.** `analysis/key_cnn.py`, a partir de Korzeniowski y Widmer (ISMIR 2018): espectrograma
logarítmico de 4 octavas (C2–C6, dos bins por semitono, afinación compensada), cinco
convoluciones 5×5 de 8 canales, una convolución sobre todo el eje de frecuencia y la media de las
24 salidas a lo largo del tema. Se entrena con `tools/train_key_cnn.py` (PyTorch, solo en local)
en GiantSteps-MTG-Key con transposiciones de ±6 semitonos y se ejecuta en numpy. Se distribuye la
media de 3 redes con semillas distintas (`key_cnn.npz`, 496 KB). La decisión final multiplica las
probabilidades de los perfiles y de la red con un peso de 0,8 para la red (`cnn_weight` en
`key_weights.json`), elegido con validación cruzada en MTG-Key; así la confianza solo es alta
cuando los dos coinciden. Si falta `key_cnn.npz`, la app usa solo los perfiles.

Experimentos (MIREX de la red sola, validación cruzada de 5 particiones en MTG-Key):

| Variante | MIREX |
|---|---|
| Parte armónica (HPSS), 4 octavas, 80 épocas | 0,732 |
| Parte armónica, 200 épocas | 0,728 |
| Espectro completo, 200 épocas | 0,734 |
| **Espectro completo, 80 épocas, normalización igual que en la app** | **0,744** |
| Espectro completo, 5 octavas (C2–C7) | 0,737 |
| Media de 3 semillas | 0,744 |
| + 174 temas de confianza 1 solo en el entrenamiento | 0,737 |
| **Red + perfiles aprendidos (peso 0,8)** | **0,750** |

Ninguna variante se acercó a 0,80: con ~1 150 temas de entrenamiento la red se estanca en 0,74–0,75.
Lo que queda por probar está en `PROGRESS.md` (más datos de entrenamiento con licencia compatible).

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
uv run python -m tools.train_key_cnn --cv --full  # validación cruzada de la red
uv run python -m tools.train_key_cnn --combine --full --seeds 3   # peso de la red
uv run python -m tools.train_key_cnn --full --seeds 3 --device mps  # key_cnn.npz
uv run python -m tools.eval_key --giantsteps
uv run python -m tools.eval_tempo --giantsteps --v2
uv run python -m tools.eval_tempo --giantsteps    # anotaciones originales
uv run python -m tools.eval_key --tags ~/Música   # con las etiquetas de tu propia biblioteca
```
