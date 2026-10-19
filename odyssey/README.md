# Odyssey

Odyssey é um hub de emuladores para Windows: uma biblioteca em Electron que abre cada jogo no motor certo.

| Console | Motor | Formatos | BIOS |
| --- | --- | --- | --- |
| PlayStation 2 | fork do [PCSX2](https://github.com/PCSX2/pcsx2) (GPL v3) | `.iso`, `.chd` | a do seu PS2 |
| Dreamcast | [Flycast](https://github.com/flyinghead/flycast) (GPL v2), build oficial | `.gdi`, `.cdi`, `.chd` | não precisa |

O Flycast guarda configurações e saves de VMU em `%APPDATA%\Odyssey\engines\flycast`.

## Como baixar

Baixe o instalador `Odyssey-Setup-x.y.z.exe` na página de
[Releases](https://github.com/JulioMLucena/Odyssey/releases/latest). Também há a versão portátil
(`Odyssey-Portatil-x.y.z.exe`).

## Atualizações

A versão instalada procura atualizações sozinha ao abrir e a cada hora. Quando acha uma, baixa só as
partes que mudaram e mostra **Reiniciar e atualizar** no topo. Se você fechar o Odyssey sem clicar, ela
é aplicada no fechamento. A versão portátil só avisa que existe uma nova, porque não consegue se
substituir.

Cada envio para a branch `master` gera uma versão nova (`0.2.<número da build>`).

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

O launcher guarda as configurações do motor em `%APPDATA%\Odyssey\engine-data\PCSX2`, separado de qualquer
PCSX2 instalado no PC. As BIOS ficam em `...\PCSX2\bios`, e o Odyssey escolhe a da mesma região do jogo.

## Licença

O Odyssey é software livre sob a GPL v3 ou posterior, como o PCSX2. Se você distribuir o Odyssey,
o código-fonte tem que ir junto ou estar disponível. Nunca coloque BIOS ou jogos neste repositório.
