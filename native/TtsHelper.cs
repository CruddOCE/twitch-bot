using System;
using System.Speech.Synthesis;

// Standalone TTS renderer used by src/ttsEngine.js instead of shelling out
// to PowerShell. Spawning powershell.exe and Add-Type-loading
// System.Speech from a script string costs ~650ms per call just in host
// startup and reflection -- a compiled .exe referencing System.Speech.dll
// directly skips both. Text/paths arrive as real process arguments
// (execFile array), not embedded in a shell/script string, so there's no
// quoting/escaping to get right either.
//
// Usage:
//   tts-helper.exe --list-voices
//   tts-helper.exe <outputWavPath> <text> [voiceName]
class TtsHelper
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length >= 1 && args[0] == "--list-voices")
            {
                using (var synth = new SpeechSynthesizer())
                {
                    foreach (var voice in synth.GetInstalledVoices())
                    {
                        if (voice.Enabled) Console.WriteLine(voice.VoiceInfo.Name);
                    }
                }
                return 0;
            }

            if (args.Length < 2)
            {
                Console.Error.WriteLine("Usage: tts-helper.exe <outputWavPath> <text> [voiceName]");
                Console.Error.WriteLine("       tts-helper.exe --list-voices");
                return 1;
            }

            string outputPath = args[0];
            string text = args[1];
            string voiceName = args.Length > 2 ? args[2] : null;

            using (var synth = new SpeechSynthesizer())
            {
                if (!string.IsNullOrEmpty(voiceName))
                {
                    try { synth.SelectVoice(voiceName); }
                    catch { /* fall back to the default voice */ }
                }
                synth.SetOutputToWaveFile(outputPath);
                synth.Speak(text);
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("TTS failed: " + ex.Message);
            return 1;
        }
    }
}
