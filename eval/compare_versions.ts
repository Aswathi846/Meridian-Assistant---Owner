import * as fs from 'fs';
import * as path from 'path';

interface ResultItem {
    id: string;
    category: string;
    routing_correct: boolean;
    answer_correct: boolean;
    retrieval_hit: boolean;
    grounded: boolean;
}

function compareVersions() {
    const v1Path = path.join(__dirname, 'results-v1.json');
    const v2Path = path.join(__dirname, 'results-v2.json');

    if (!fs.existsSync(v1Path) || !fs.existsSync(v2Path)) {
        console.error('Error: results-v1.json or results-v2.json not found!');
        process.exit(1);
    }

    const v1: ResultItem[] = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
    const v2: ResultItem[] = JSON.parse(fs.readFileSync(v2Path, 'utf8'));

    if (v1.length !== v2.length) {
        console.error('Error: Mismatched number of test cases between v1 and v2.');
        process.exit(1);
    }

    const pillars = ['routing_correct', 'answer_correct', 'retrieval_hit', 'grounded'] as const;

    console.log('============================================================');
    console.log(' B6 COMPARISON REPORT: results-v1.json vs results-v2.json');
    console.log('============================================================\n');

    pillars.forEach(pillar => {
        let v1Pass = 0;
        let v2Pass = 0;
        let fixed = 0;   // False -> True
        let broken = 0;  // True -> False
        let unchangedTrue = 0;
        let unchangedFalse = 0;

        for (let i = 0; i < v1.length; i++) {
            const val1 = v1[i][pillar];
            const val2 = v2[i][pillar];

            if (val1) v1Pass++;
            if (val2) v2Pass++;

            if (!val1 && val2) fixed++;
            if (val1 && !val2) broken++;
            if (val1 && val2) unchangedTrue++;
            if (!val1 && !val2) unchangedFalse++;
        }

        const netChange = fixed - broken;
        const formattedNet = netChange >= 0 ? '+' + netChange : netChange;

        console.log(`Pillar: ${pillar.toUpperCase()}`);
        console.log(`  Before (v1):   ${v1Pass}/${v1.length}`);
        console.log(`  After (v2):    ${v2Pass}/${v1.length}`);
        console.log(`  Directional Changes:`);
        console.log(`    - Fixed (Fail -> Pass):     ${fixed}`);
        console.log(`    - Broken (Pass -> Fail):    ${broken}`);
        console.log(`    - Net Gain / Loss:          ${formattedNet}`);
        console.log(`------------------------------------------------------------`);
    });
}

compareVersions();