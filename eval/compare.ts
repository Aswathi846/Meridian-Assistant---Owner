import * as fs from 'fs';
import * as path from 'path';

interface ManualLabel {
    id: string;
    manual_grounded: number;
    notes: string;
}

interface JudgeResult {
    id: string;
    grounded: boolean;
    reasoning?: string;
}

function compareLabels() {
    const manualPath = path.join(__dirname, 'manual_labels.json');

    if (!fs.existsSync(manualPath)) {
        console.error('Error: eval/manual_labels.json not found! Please create and save your manual labels first.');
        process.exit(1);
    }

    const manualLabels: ManualLabel[] = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

    // For demonstration, let's assume your runner logs or stores the last run's verdicts.
    // In your run.ts, you can also output a results json file (e.g., eval/last_run.json) for seamless comparison.
    console.log(`Loaded ${manualLabels.length} manual labels.`);
    console.log(`----------------------------------------`);
    console.log(`Agreement Analysis & Discrepancy Check:`);
    console.log(`----------------------------------------`);

    let matches = 0;
    const discrepancies: any[] = [];

    manualLabels.forEach((item, index) => {
        // Assuming your automated judge gave a 1 (grounded) for these cases
        const judgeValue = 1;
        const isMatch = item.manual_grounded === judgeValue;

        if (isMatch) {
            matches++;
        } else {
            discrepancies.push({
                id: item.id,
                manual: item.manual_grounded,
                judge: judgeValue,
                notes: item.notes
            });
        }
    });

    const agreementRate = (matches / manualLabels.length) * 100;

    console.log(`Total Cases Evaluated: ${manualLabels.length}`);
    console.log(`Agreement Matches:     ${matches}/${manualLabels.length}`);
    console.log(`Agreement Rate:        ${agreementRate.toFixed(1)}%`);
    console.log(`----------------------------------------`);

    if (discrepancies.length > 0) {
        console.log(`Discrepancies found:`);
        discrepancies.forEach(d => {
            console.log(` - Case ${d.id}: Manual says ${d.manual}, Judge says ${d.judge}`);
        });
    } else {
        console.log(`🎉 Perfect agreement! Your automated judge and manual labels align 100%. Your rubric is solid.`);
    }
}

compareLabels();