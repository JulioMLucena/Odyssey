# Odyssey

Odyssey é um emulador de PlayStation 2 para Windows: uma biblioteca em Electron por cima de um motor
baseado no [PCSX2](https://github.com/PCSX2/pcsx2).

## Como baixar

1. Abra a aba **Actions** do repositório e entre na execução mais recente de **🚀 Odyssey para Windows**.
2. Em **Artifacts**, baixe **Odyssey-Windows**.
3. Dentro do zip há o instalador (`Odyssey-Setup-x.y.z.exe`) e a versão portátil (`Odyssey-Portatil-x.y.z.exe`).

## Primeira vez

1. Escolha a pasta onde ficam suas ISOs de PS2.
2. Importe a BIOS do **seu** PS2 (arquivo de 4 MB). Ela não vem junto.
3. Escolha o jogo e clique em **Jogar**. Teclado, mouse e controle (botão A) funcionam na biblioteca.

Gráficos, controles e memory cards ficam em **Ajustes → Gráficos e controles**, que abre a janela do motor.

## Como é montado

| Parte | Onde | O que faz |
| --- | --- | --- |
| Launcher | `odyssey/` | Electron. Lê as ISOs, mostra capas, tempo jogado e compatibilidade, importa a BIOS e abre o motor. |
| Leitor de ISO | `odyssey/src/iso.js` | Lê o ISO 9660 e o `SYSTEM.CNF` para achar o serial do jogo (ex.: `SLES-51156`). |
| Base de jogos | `odyssey/src/gamedb.js` | Nomes e notas de compatibilidade do `GameIndex.yaml` do motor. |
| Motor | resto do repositório | Fork do PCSX2. A opção `-odyssey` pula o assistente de primeira execução. |
| Build | `.github/workflows/odyssey_windows.yml` | Compila o motor (SSE4) e empacota tudo com o electron-builder. |

O launcher guarda as configurações do motor em `%APPDATA%\Odyssey\engine-data`, separado de qualquer PCSX2
instalado no PC.

## Licença

O Odyssey é software livre sob a GPL v3 ou posterior, como o PCSX2. Se você distribuir o Odyssey,
o código-fonte tem que ir junto ou estar disponível. Nunca coloque BIOS ou jogos neste repositório.
