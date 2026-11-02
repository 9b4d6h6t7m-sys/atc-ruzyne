/* batchtts: load one sherpa-onnx TTS model once and synthesise many lines.
   usage: batchtts kokoro <model> <voices> <tokens> <data_dir> <lang> <sid> <speed> <list.tsv> <outdir>
          batchtts vits   <model> <tokens> <data_dir> <sid> <speed> <list.tsv> <outdir>
   list.tsv lines: id<TAB>text   ->  outdir/id.wav */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sherpa-onnx/c-api/c-api.h"
int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage\n"); return 1; }
  SherpaOnnxOfflineTtsConfig cfg; memset(&cfg, 0, sizeof(cfg));
  cfg.model.num_threads = 2; cfg.model.provider = "cpu"; cfg.max_num_sentences = 1; cfg.silence_scale = 0.2f;
  int sid; float speed; const char *list, *outdir;
  if (!strcmp(argv[1], "kokoro") && argc == 11) {
    cfg.model.kokoro.model = argv[2]; cfg.model.kokoro.voices = argv[3]; cfg.model.kokoro.tokens = argv[4];
    cfg.model.kokoro.data_dir = argv[5]; cfg.model.kokoro.lang = argv[6]; cfg.model.kokoro.length_scale = 1.0f;
    sid = atoi(argv[7]); speed = atof(argv[8]); list = argv[9]; outdir = argv[10];
  } else if (!strcmp(argv[1], "vits") && argc == 9) {
    cfg.model.vits.model = argv[2]; cfg.model.vits.tokens = argv[3]; cfg.model.vits.data_dir = argv[4];
    cfg.model.vits.noise_scale = 0.5f; cfg.model.vits.noise_scale_w = 0.6f; cfg.model.vits.length_scale = 1.0f;
    sid = atoi(argv[5]); speed = atof(argv[6]); list = argv[7]; outdir = argv[8];
  } else { fprintf(stderr, "bad args\n"); return 1; }
  const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&cfg);
  if (!tts) { fprintf(stderr, "create failed\n"); return 2; }
  FILE *f = fopen(list, "r"); if (!f) { fprintf(stderr, "no list\n"); return 3; }
  char line[4096]; int n = 0;
  while (fgets(line, sizeof line, f)) {
    char *tab = strchr(line, '\t'); if (!tab) continue; *tab = 0; char *text = tab + 1;
    size_t L = strlen(text); while (L && (text[L - 1] == '\n' || text[L - 1] == '\r')) text[--L] = 0;
    const SherpaOnnxGeneratedAudio *a = SherpaOnnxOfflineTtsGenerate(tts, text, sid, speed);
    if (!a || a->n <= 0) { fprintf(stderr, "fail %s\n", line); continue; }
    char path[1024]; snprintf(path, sizeof path, "%s/%s.wav", outdir, line);
    SherpaOnnxWriteWave(a->samples, a->n, a->sample_rate, path);
    SherpaOnnxDestroyOfflineTtsGeneratedAudio(a); n++;
  }
  fclose(f); SherpaOnnxDestroyOfflineTts(tts); printf("generated %d\n", n); return 0;
}
